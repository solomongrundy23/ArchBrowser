'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

// Встраивание OpenCode в браузер.
//
// Запускается `opencode serve` на локальном порту, веб-интерфейс OpenCode
// открывается во встроенной панели. Авторизация — через код подключения:
// сервер выдаёт его по паролю, а веб-интерфейс обменивает его на сессию.

const CANDIDATES = [
  // Настольное приложение OpenCode (самая свежая версия CLI).
  () => path.join(
    os.homedir(),
    'AppData', 'Local', 'Programs', '@opencodedesktop', 'resources', 'opencode-cli.exe',
  ),
  // В поставке браузера.
  () => path.join(__dirname, '..', '..', 'resources', 'opencode', 'opencode.exe'),
  () => path.join(os.homedir(), '.opencode', 'bin', 'opencode.exe'),
  () => path.join(os.homedir(), '.local', 'bin', 'opencode'),
  () => path.join(os.homedir(), '.bun', 'bin', 'opencode'),
  () => path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'opencode.cmd'),
  () => path.join(os.homedir(), '.cargo', 'bin', 'opencode'),
];

function request(method, url, { headers = {}, body = null } = {}) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (err) {
      resolve({ status: 0, headers: {}, body: String(err.message) });
      return;
    }
    const req = http.request({
      method,
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      headers,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', (err) => resolve({ status: 0, headers: {}, body: String(err.message) }));
    if (body) req.write(body);
    req.end();
  });
}

class OpenCodeService {
  constructor({ resourcesDir, getSettings, onChange }) {
    this.resourcesDir = resourcesDir;
    this.getSettings = getSettings || (() => null);
    this.onChange = onChange || (() => {});
    this.proc = null;
    this.url = '';
    this.password = '';
    this.pairLink = '';
    this.directory = '';
    this.state = 'stopped'; // stopped | starting | running | error
    this.error = '';
  }

  // ---------- поиск исполняемого файла ----------

  cliPath() {
    for (const candidate of CANDIDATES) {
      try {
        const file = candidate();
        if (file && fs.existsSync(file)) return file;
      } catch {}
    }
    return '';
  }

  available() {
    return !!this.cliPath();
  }

  version() {
    const cli = this.cliPath();
    if (!cli) return '';
    try {
      return require('child_process').execFileSync(cli, ['--version'], {
        encoding: 'utf8',
        timeout: 15000,
        windowsHide: true,
      }).trim();
    } catch {
      return '';
    }
  }

  // ---------- запуск ----------

  // Папка проекта. Путь внутри asar-архива нельзя использовать как рабочий
  // каталог дочернего процесса — в этом случае берём домашнюю папку.
  _resolveDirectory(directory) {
    let dir = directory || this.getSettings('opencodeDirectory') || '';
    if (!dir || /\.asar([\\/]|$)/i.test(dir) || !fs.existsSync(dir)) {
      dir = os.homedir();
    }
    return dir;
  }

  async start(directory) {
    if (this.state === 'starting' || this.state === 'running') return this.status();
    const cli = this.cliPath();
    if (!cli) {
      this.state = 'error';
      this.error = 'OpenCode не найден: установите настольное приложение OpenCode или CLI';
      this.onChange();
      throw new Error(this.error);
    }
    const dir = this._resolveDirectory(directory);
    if (!fs.existsSync(dir)) {
      this.state = 'error';
      this.error = `Папка проекта не найдена: ${dir}`;
      this.onChange();
      throw new Error(this.error);
    }
    this.state = 'starting';
    this.error = '';
    this.directory = dir;
    this.onChange();

    const port = await this._freePort();
    const args = ['serve', '--hostname', '127.0.0.1', '--port', String(port)];
    const proc = spawn(cli, args, { cwd: dir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc = proc;

    let out = '';
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('OpenCode не запустился за 40 секунд')), 40000);
      const onData = (chunk) => {
        out += chunk.toString();
        const url = out.match(/server listening on (http:\/\/\S+)/);
        const pass = out.match(/server password (\S+)/);
        if (url && pass) {
          clearTimeout(timer);
          this.url = url[1].replace(/\/$/, '');
          this.password = pass[1];
          resolve();
        }
      };
      proc.stdout.on('data', onData);
      proc.stderr.on('data', onData);
      proc.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`OpenCode завершился (код ${code ?? '?'})`));
      });
      proc.once('error', (err) => {
        clearTimeout(timer);
        reject(new Error(err.message));
      });
    });

    try {
      await ready;
      this.pairLink = await this._pair();
      this.state = 'running';
      this.onChange();
      return this.status();
    } catch (err) {
      this.state = 'error';
      this.error = err.message;
      this.proc = null;
      this.onChange();
      throw err;
    }
  }

  async _freePort() {
    return new Promise((resolve, reject) => {
      const net = require('net');
      const srv = net.createServer();
      srv.once('error', reject);
      srv.listen(0, '127.0.0.1', () => {
        const { port } = srv.address();
        srv.close(() => resolve(port));
      });
    });
  }

  // Обмен пароля сервера на код подключения.
  async _pair() {
    const auth = 'Basic ' + Buffer.from('opencode:' + this.password).toString('base64');
    const res = await request('POST', `${this.url}/api/pair`, {
      headers: { authorization: auth, 'content-type': 'application/json' },
      body: '{}',
    });
    if (res.status !== 200) throw new Error('Не удалось получить код подключения OpenCode');
    let code = '';
    try {
      code = JSON.parse(res.body).code || '';
    } catch {}
    if (!code) throw new Error('OpenCode вернул некорректный код подключения');
    return `${this.url}/auth/connect/${code}`;
  }

  // Ссылка, которую нужно вставить в поле адреса сервера в веб-интерфейсе.
  connectLink() {
    return this.pairLink;
  }

  status() {
    return {
      state: this.state,
      url: this.url,
      directory: this.directory,
      error: this.error,
      version: this.state === 'running' ? this.version() : '',
      available: this.available(),
    };
  }

  stop() {
    if (this.proc) {
      try {
        this.proc.kill();
      } catch {}
      this.proc = null;
    }
    this.state = 'stopped';
    this.url = '';
    this.password = '';
    this.pairLink = '';
    this.onChange();
  }
}

module.exports = { OpenCodeService };
