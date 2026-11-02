'use strict';

const { EventEmitter } = require('events');
const { spawn, execFileSync } = require('child_process');
const net = require('net');
const dns = require('dns');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { net: electronNet } = require('electron');
const { JsonStore } = require('./store');

const SUPPORTED_SCHEMES = ['vless', 'vmess', 'trojan', 'ss', 'socks', 'http'];

// Домены, которые при включённом обходе идут напрямую (.ru и .рф).
// В PAC имена приходят в punycode, поэтому .рф = .xn--p1ai.
function isDirectBypassHost(host) {
  const h = String(host || '').toLowerCase();
  if (!h) return false;
  return (
    h === 'ru' || h.endsWith('.ru') ||
    h === 'xn--p1ai' || h.endsWith('.xn--p1ai') ||
    h === 'рф' || h.endsWith('.рф')
  );
}

function b64decode(input) {
  let s = String(input).trim().replace(/\s+/g, '');
  if (!s) return '';
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  try {
    return Buffer.from(s, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function looksLikeBase64(text) {
  const s = text.trim();
  return s.length > 16 && !s.includes('://') && /^[A-Za-z0-9+/=_\-\s]+$/.test(s);
}

function decodeMaybeBase64(text) {
  if (!looksLikeBase64(text)) return text;
  const decoded = b64decode(text);
  return decoded.includes('://') ? decoded : text;
}

function safeDecode(value) {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function defaultName(p) {
  return `${p.address}:${p.port}`;
}

function parseVless(raw) {
  const u = new URL(raw);
  const p = u.searchParams;
  const security = (p.get('security') || 'none').toLowerCase();
  const network = (p.get('type') || 'tcp').toLowerCase();
  const address = u.hostname;
  const port = Number(u.port || (security === 'tls' ? 443 : 80));
  return {
    protocol: 'vless',
    address,
    port,
    id: safeDecode(u.username),
    flow: p.get('flow') || '',
    network,
    security,
    sni: p.get('sni') || p.get('host') || address,
    host: p.get('host') || '',
    path: safeDecode(p.get('path') || '/'),
    serviceName: p.get('serviceName') || '',
    headerType: p.get('headerType') || 'none',
    fingerprint: p.get('fp') || 'chrome',
    alpn: p.get('alpn') ? p.get('alpn').split(',') : undefined,
    pbk: p.get('pbk') || '',
    sid: p.get('sid') || '',
    spx: p.get('spx') || '/',
    allowInsecure: p.get('allowInsecure') === '1' || p.get('allowInsecure') === 'true',
    name: safeDecode(u.hash.slice(1)) || defaultName({ address, port }),
  };
}

function parseVmess(raw) {
  const decoded = b64decode(raw.slice('vmess://'.length));
  let j;
  try {
    j = JSON.parse(decoded);
  } catch {
    throw new Error('Некорректная vmess-ссылка (не удалось разобрать base64/JSON)');
  }
  if (!j.add || !j.id) throw new Error('В vmess-ссылке нет адреса или UUID');
  const address = String(j.add);
  const security = String(j.tls || '').toLowerCase() === 'tls' ? 'tls' : 'none';
  return {
    protocol: 'vmess',
    address,
    port: Number(j.port || 443),
    id: String(j.id),
    alterId: Number(j.aid || 0),
    cipher: j.scy || 'auto',
    network: (j.net || 'tcp').toLowerCase(),
    security,
    sni: j.sni || j.host || address,
    host: j.host || '',
    path: safeDecode(j.path || '/'),
    headerType: j.type || 'none',
    alpn: typeof j.alpn === 'string' && j.alpn ? j.alpn.split(',') : undefined,
    fingerprint: 'chrome',
    name: j.ps || defaultName({ address, port: j.port }),
  };
}

function parseTrojan(raw) {
  const u = new URL(raw);
  const p = u.searchParams;
  const address = u.hostname;
  const port = Number(u.port || 443);
  return {
    protocol: 'trojan',
    address,
    port,
    password: safeDecode(u.username),
    network: (p.get('type') || 'tcp').toLowerCase(),
    security: (p.get('security') || 'tls').toLowerCase(),
    sni: p.get('sni') || p.get('host') || address,
    host: p.get('host') || '',
    path: safeDecode(p.get('path') || '/'),
    serviceName: p.get('serviceName') || '',
    headerType: p.get('headerType') || 'none',
    fingerprint: p.get('fp') || 'chrome',
    alpn: p.get('alpn') ? p.get('alpn').split(',') : undefined,
    allowInsecure: p.get('allowInsecure') === '1' || p.get('allowInsecure') === 'true',
    name: safeDecode(u.hash.slice(1)) || defaultName({ address, port }),
  };
}

function parseShadowsocks(raw) {
  let body = raw.slice('ss://'.length);
  let name = '';
  const hashIndex = body.indexOf('#');
  if (hashIndex >= 0) {
    name = safeDecode(body.slice(hashIndex + 1));
    body = body.slice(0, hashIndex);
  }
  const qIndex = body.indexOf('?');
  if (qIndex >= 0) body = body.slice(0, qIndex);

  let method;
  let password;
  let address;
  let port;

  const at = body.lastIndexOf('@');
  if (at >= 0) {
    const credsRaw = body.slice(0, at);
    const hostPort = body.slice(at + 1);
    let creds = credsRaw;
    if (!creds.includes(':')) creds = b64decode(creds);
    else creds = safeDecode(creds);
    const sep = creds.indexOf(':');
    if (sep < 0) throw new Error('Некорректные данные Shadowsocks');
    method = creds.slice(0, sep);
    password = creds.slice(sep + 1);

    const hp = hostPort.match(/^\[?([^\]]+)\]?:(\d+)$/);
    if (!hp) throw new Error('Некорректный адрес Shadowsocks');
    address = hp[1];
    port = Number(hp[2]);
  } else {
    const decoded = b64decode(body);
    const match = decoded.match(/^([^:]+):(.*)@\[?([^\]]+)\]?:(\d+)$/);
    if (!match) throw new Error('Некорректная ss-ссылка');
    method = match[1];
    password = match[2];
    address = match[3];
    port = Number(match[4]);
  }

  if (!method || !password || !address || !port) throw new Error('Некорректная ss-ссылка');
  return {
    protocol: 'ss',
    address,
    port,
    method,
    password,
    network: 'tcp',
    security: 'none',
    name: name || defaultName({ address, port }),
  };
}

function parseProxyUri(raw) {
  const u = new URL(raw);
  const protocol = u.protocol === 'https:' ? 'http' : u.protocol.replace(':', '');
  if (!SUPPORTED_SCHEMES.includes(protocol)) throw new Error(`Протокол ${protocol} не поддерживается`);
  const address = u.hostname;
  const port = Number(u.port || (protocol === 'http' ? 8080 : 1080));
  return {
    protocol,
    address,
    port,
    username: safeDecode(u.username),
    password: safeDecode(u.password),
    network: 'tcp',
    security: 'none',
    name: safeDecode(u.hash.slice(1)) || defaultName({ address, port }),
  };
}

function parseLink(raw) {
  const link = String(raw).trim();
  const scheme = (link.split('://')[0] || '').toLowerCase();
  switch (scheme) {
    case 'vless':
      return parseVless(link);
    case 'vmess':
      return parseVmess(link);
    case 'trojan':
      return parseTrojan(link);
    case 'ss':
      return parseShadowsocks(link);
    case 'socks':
    case 'http':
    case 'https':
      return parseProxyUri(link);
    default:
      throw new Error(`Неизвестный протокол: ${scheme || '?'}`);
  }
}

function validateParsed(p) {
  if (!p.address || !p.port || p.port < 1 || p.port > 65535) throw new Error('Некорректный адрес или порт');
  if ((p.protocol === 'vless' || p.protocol === 'vmess') && !/^[0-9a-f-]{32,40}$/i.test(p.id || '')) {
    throw new Error('Некорректный UUID');
  }
  if (p.protocol === 'trojan' && !p.password) throw new Error('Нет пароля Trojan');
  if (p.protocol === 'ss' && (!p.method || !p.password)) throw new Error('Нет метода/пароля Shadowsocks');
  return p;
}

function extractLinks(text) {
  const clean = decodeMaybeBase64(text);
  const links = [];
  const re = /(vless|vmess|trojan|ss|socks|https?):\/\/[^\s"'<>]+/gi;
  let m;
  while ((m = re.exec(clean)) !== null) {
    if (m[0].startsWith('http://') || m[0].startsWith('https://')) {
      // http(s) считаем сервером только если это не ссылка подписки (нет пути/похоже на хост:порт)
      try {
        const u = new URL(m[0]);
        if (u.pathname === '/' || u.pathname === '') links.push(m[0]);
      } catch {}
      continue;
    }
    links.push(m[0]);
  }
  if (!links.length) {
    // Построчный разбор (иногда в подписке просто список ссылок)
    for (const line of clean.split(/\r?\n/)) {
      const t = line.trim();
      if (t && t.includes('://')) links.push(t);
    }
  }
  return [...new Set(links)];
}

function buildStreamSettings(p) {
  const network = (p.network || 'tcp').toLowerCase();
  const stream = { network };
  const security = (p.security || 'none').toLowerCase();

  if (security === 'tls') {
    stream.security = 'tls';
    stream.tlsSettings = {
      serverName: p.sni || p.address,
      allowInsecure: !!p.allowInsecure,
      fingerprint: p.fingerprint || 'chrome',
    };
    if (p.alpn && p.alpn.length) stream.tlsSettings.alpn = p.alpn;
  } else if (security === 'reality') {
    stream.security = 'reality';
    stream.realitySettings = {
      show: false,
      serverName: p.sni || p.address,
      fingerprint: p.fingerprint || 'chrome',
      publicKey: p.pbk || '',
      shortId: p.sid || '',
      spiderX: p.spx || '/',
    };
  }

  if (network === 'ws') {
    stream.wsSettings = {
      path: p.path || '/',
      headers: p.host ? { Host: p.host } : {},
    };
  } else if (network === 'httpupgrade') {
    // HTTPUpgrade (Xray): без явных настроек сервер отвечает «unrecognized
    // reply», потому что теряются путь и Host-заголовок.
    stream.httpupgradeSettings = {
      path: p.path || '/',
      host: p.host || p.address,
    };
  } else if (network === 'splithttp') {
    stream.splithttpSettings = {
      path: p.path || '/',
      host: p.host || p.address,
    };
  } else if (network === 'grpc') {
    stream.grpcSettings = { serviceName: p.serviceName || p.path || '' };
  } else if (network === 'http' || network === 'h2') {
    stream.network = 'http';
    stream.httpSettings = { host: [p.host || p.address], path: p.path || '/' };
  } else if (network === 'xhttp') {
    stream.network = 'xhttp';
    stream.xhttpSettings = {
      path: p.path || '/',
      host: p.host || p.address,
      mode: p.xhttpMode || 'auto',
    };
  } else if (network === 'kcp') {
    stream.kcpSettings = {
      seed: p.seed || '',
      header: { type: p.headerType || 'none' },
    };
  } else if (network === 'quic') {
    stream.quicSettings = {
      security: p.quicSecurity || 'none',
      key: p.key || '',
      header: { type: p.headerType || 'none' },
    };
  } else if (network === 'tcp' && (p.headerType || 'none') === 'http') {
    stream.tcpSettings = {
      header: {
        type: 'http',
        request: {
          version: '1.1',
          method: 'GET',
          path: [p.path || '/'],
          headers: { Host: [p.host || p.address] },
        },
      },
    };
  }
  return stream;
}

function buildOutbound(server) {
  const p = server.parsed;
  const base = { tag: 'proxy', streamSettings: buildStreamSettings(p) };
  switch (p.protocol) {
    case 'vless':
      return {
        ...base,
        protocol: 'vless',
        settings: {
          vnext: [
            {
              address: p.address,
              port: p.port,
              // Пустой flow передавать нельзя — Xray ждёт отсутствие поля.
              users: [{ id: p.id, encryption: 'none', ...(p.flow ? { flow: p.flow } : {}) }],
            },
          ],
        },
      };
    case 'vmess':
      return {
        ...base,
        protocol: 'vmess',
        settings: {
          vnext: [
            {
              address: p.address,
              port: p.port,
              users: [{ id: p.id, alterId: p.alterId || 0, security: p.cipher || 'auto' }],
            },
          ],
        },
      };
    case 'trojan':
      return {
        ...base,
        protocol: 'trojan',
        settings: { servers: [{ address: p.address, port: p.port, password: p.password }] },
      };
    case 'ss':
      return {
        ...base,
        protocol: 'shadowsocks',
        settings: {
          servers: [{ address: p.address, port: p.port, method: p.method, password: p.password }],
        },
      };
    case 'socks':
      return {
        ...base,
        protocol: 'socks',
        settings: {
          servers: [
            {
              address: p.address,
              port: p.port,
              users: p.username ? [{ user: p.username, pass: p.password }] : [],
            },
          ],
        },
      };
    case 'http':
      return {
        ...base,
        protocol: 'http',
        settings: {
          servers: [
            {
              address: p.address,
              port: p.port,
              users: p.username ? [{ user: p.username, pass: p.password }] : [],
            },
          ],
        },
      };
    default:
      throw new Error('Неподдерживаемый протокол: ' + p.protocol);
  }
}

function waitPort(port, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const attempt = () => {
      const socket = net.connect({ host: '127.0.0.1', port });
      const done = (err) => {
        socket.removeAllListeners();
        socket.destroy();
        if (err) {
          if (Date.now() - started > timeoutMs) reject(new Error('Таймаут запуска Xray'));
          else setTimeout(attempt, 150);
        } else {
          resolve();
        }
      };
      socket.once('connect', () => done(null));
      socket.once('error', (err) => done(err));
      socket.setTimeout(1000, () => done(new Error('timeout')));
    };
    attempt();
  });
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

function tcpLatency(host, port, timeout = 4500) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.connect({ host, port });
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => finish({ ok: true, ms: Date.now() - started }));
    socket.once('timeout', () => finish({ ok: false, error: 'таймаут' }));
    socket.once('error', (err) => finish({ ok: false, error: err.code || err.message }));
  });
}

class VpnManager extends EventEmitter {
  constructor({ resourcesDir, userDataDir, getSettings }) {
    super();
    this.resourcesDir = resourcesDir;
    this.userDataDir = userDataDir;
    this.getSettings = getSettings;
    this.xrayDir = path.join(resourcesDir, 'xray');
    // На macOS/Linux бинарник Xray называется без .exe.
    this.xrayExe = path.join(this.xrayDir, process.platform === 'win32' ? 'xray.exe' : 'xray');
    this.store = new JsonStore(path.join(userDataDir, 'vpn.json'), {
      servers: [],
      activeId: null,
      subscriptions: [],
    });
    this.sessions = new Set();
    this.proc = null;
    this.connected = false;
    this.connecting = false;
    this.stopping = false;
    this.lastError = '';
    this.startedAt = 0;
    this.logs = [];
    this.runtimeSocksPort = 0;
    this.runtimeHttpPort = 0;
    this._changeTimer = null;
    // Сайты .ru/.рф, которые не открылись напрямую: их отправляем через VPN.
    // Хранится только в памяти — при перезапуске пробуем напрямую заново.
    this.directFailed = new Set();
  }

  coreAvailable() {
    return fs.existsSync(this.xrayExe);
  }

  // macOS: бинарник из архива/сборки может потерять бит выполнения, а
  // скачанный DMG — получить карантин. Без этого spawn падает с EACCES/
  // «Operation not permitted», и VPN выглядит нерабочим.
  _prepareXray() {
    if (process.platform === 'win32') return;
    try {
      fs.chmodSync(this.xrayExe, 0o755);
    } catch {}
    if (process.platform === 'darwin') {
      try {
        execFileSync('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', this.xrayDir], {
          stdio: 'ignore',
          timeout: 5000,
        });
      } catch {}
    }
  }

  servers() {
    return this.store.get('servers') || [];
  }

  subscriptions() {
    return this.store.get('subscriptions') || [];
  }

  activeServer() {
    const id = this.store.get('activeId');
    return this.servers().find((s) => s.id === id) || null;
  }

  registerSession(ses) {
    this.sessions.add(ses);
    if (this.connected) this._applyProxy(ses, true).catch(() => {});
  }

  _emitSoon() {
    clearTimeout(this._changeTimer);
    this._changeTimer = setTimeout(() => this.emit('change', this.status()), 80);
  }

  status() {
    return {
      connected: this.connected,
      connecting: this.connecting,
      activeId: this.store.get('activeId'),
      active: this.activeServer(),
      servers: this.servers(),
      subscriptions: this.subscriptions(),
      error: this.lastError,
      uptime: this.connected ? Math.floor((Date.now() - this.startedAt) / 1000) : 0,
      socksPort: this.connected ? this.runtimeSocksPort : this.getSettings().vpnSocksPort,
      httpPort: this.connected ? this.runtimeHttpPort : this.getSettings().vpnHttpPort,
      coreAvailable: this.coreAvailable(),
      bypassRu: !!this.getSettings().vpnBypassRu,
      directFailed: this.directFailed.size,
      logs: this.logs.slice(-40),
    };
  }

  _log(chunk) {
    const text = String(chunk)
      .replace(/\x1b\[[0-9;]*m/g, '')
      .trim();
    if (!text) return;
    for (const line of text.split(/\r?\n/)) {
      this.logs.push(line);
    }
    if (this.logs.length > 200) this.logs = this.logs.slice(-200);
  }

  addFromText(text, { subscription = null } = {}) {
    const links = extractLinks(text);
    const added = [];
    const errors = [];
    const servers = [...this.servers()];

    for (const link of links) {
      try {
        const parsed = validateParsed(parseLink(link));
        if (servers.some((s) => s.raw === link)) continue;
        const server = {
          id: crypto.randomUUID(),
          name: parsed.name || `${parsed.address}:${parsed.port}`,
          protocol: parsed.protocol,
          address: parsed.address,
          port: parsed.port,
          raw: link,
          parsed,
          subscription,
          addedAt: Date.now(),
          latency: null,
        };
        servers.push(server);
        added.push(server);
      } catch (err) {
        errors.push(`${link.slice(0, 60)}… — ${err.message}`);
      }
    }

    this.store.set({
      servers,
      activeId: this.store.get('activeId') || (servers[0] ? servers[0].id : null),
    });
    this._emitSoon();
    return { added: added.length, errors, servers: added };
  }

  async addSubscription(url) {
    const res = await electronNet.fetch(url, {
      headers: { 'User-Agent': 'ArchBrowser/1.0' },
    });
    if (!res.ok) throw new Error(`Сервер подписки ответил ${res.status}`);
    const text = await res.text();
    const result = this.addFromText(text, { subscription: url });
    if (!result.added && !result.errors.length) throw new Error('В подписке не найдено серверов');
    if (!result.added && result.errors.length) throw new Error(result.errors[0]);

    const subs = [...this.subscriptions()];
    const existing = subs.findIndex((s) => s.url === url);
    const entry = {
      url,
      name: (() => { try { return new URL(url).hostname; } catch { return 'Подписка'; } })(),
      updatedAt: Date.now(),
      count: result.added,
    };
    if (existing >= 0) subs[existing] = entry;
    else subs.push(entry);
    this.store.set({ subscriptions: subs });
    this._emitSoon();
    return { ...result, subscription: entry };
  }

  removeServer(id) {
    const wasActive = this.store.get('activeId') === id;
    const servers = this.servers().filter((s) => s.id !== id);
    let activeId = this.store.get('activeId');
    if (activeId === id) activeId = servers[0] ? servers[0].id : null;
    this.store.set({ servers, activeId });
    if (wasActive && this.connected) {
      this.disconnect().catch(() => {});
    }
    this._emitSoon();
    return { servers };
  }

  selectServer(id) {
    const server = this.servers().find((s) => s.id === id);
    if (!server) throw new Error('Сервер не найден');
    this.store.set({ activeId: id });
    this._emitSoon();
    return server;
  }

  async findFreePorts() {
    const settings = this.getSettings();
    let socks = Number(settings.vpnSocksPort) || 10808;
    let http = Number(settings.vpnHttpPort) || 10809;
    for (let i = 0; i < 20; i++) {
      if ((await isPortFree(socks)) && (await isPortFree(http)) && socks !== http) {
        return { socks, http };
      }
      socks += 1;
      http += 1;
    }
    throw new Error('Не удалось найти свободные локальные порты для VPN');
  }

  _writeConfig(server, ports) {
    const configDir = path.join(this.userDataDir, 'vpn');
    fs.mkdirSync(configDir, { recursive: true });
    const configPath = path.join(configDir, 'config.json');
    const config = {
      log: { loglevel: 'warning', access: 'none', error: '' },
      inbounds: [
        {
          tag: 'socks-in',
          listen: '127.0.0.1',
          port: ports.socks,
          protocol: 'socks',
          settings: { auth: 'noauth', udp: true },
          sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'] },
        },
        {
          tag: 'http-in',
          listen: '127.0.0.1',
          port: ports.http,
          protocol: 'http',
          settings: {},
          sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'] },
        },
      ],
      outbounds: [
        buildOutbound(server),
        { tag: 'direct', protocol: 'freedom', settings: { domainStrategy: 'AsIs' } },
        { tag: 'block', protocol: 'blackhole' },
      ],
      routing: {
        domainStrategy: 'AsIs',
        rules: [{ type: 'field', ip: ['geoip:private'], outboundTag: 'direct' }],
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    return configPath;
  }

  async connect(id) {
    if (this.connecting) return this.status();
    if (id) this.selectServer(id);
    const server = this.activeServer();
    if (!server) throw new Error('Сначала добавьте и выберите сервер');
    this._prepareXray();
    if (!this.coreAvailable()) throw new Error(`Xray core не найден: ${this.xrayExe}`);

    if (this.connected) await this.disconnect();
    this.connecting = true;
    this.lastError = '';
    this.logs = [];
    this._emitSoon();

    let proc = null;
    try {
      const ports = await this.findFreePorts();
      const configPath = this._writeConfig(server, ports);
      this.runtimeSocksPort = ports.socks;
      this.runtimeHttpPort = ports.http;

      proc = spawn(this.xrayExe, ['run', '-c', configPath], {
        cwd: this.xrayDir,
        // Xray ищет geoip.dat/geosite.dat рядом со своим исполняемым файлом,
        // а не в cwd. Явно указываем папку ассетов, чтобы правило geoip:private
        // и geosite-фильтры всегда находили базы данных.
        env: { ...process.env, XRAY_LOCATION_ASSET: this.xrayDir },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.proc = proc;

      proc.once('error', (err) => {
        this.lastError = `Не удалось запустить Xray: ${err.message}`;
        this._emitSoon();
      });

      proc.once('exit', (code) => {
        if (this.proc !== proc) return;
        this.proc = null;
        if (this.connected) {
          this.connected = false;
          this.startedAt = 0;
          this.lastError = `Xray неожиданно остановился (код ${code ?? '?'})`;
          for (const ses of this.sessions) this._applyProxy(ses, false).catch(() => {});
          this._emitSoon();
        }
      });

      let xrayOutput = '';
      let exitCode = null;
      let exitSignal = null;
      proc.once('exit', (code, signal) => {
        exitCode = code;
        exitSignal = signal;
      });

      const exited = new Promise((_, reject) => {
        // Ждём 'close', а не 'exit': к этому моменту stdout/stderr уже вычитаны,
        // поэтому в ошибку попадает реальный вывод Xray («failed to load config…»),
        // а не только «код 23».
        proc.once('close', () => {
          const out = xrayOutput.trim();
          reject(new Error(`Xray завершился (код ${exitCode ?? exitSignal ?? '?'})${out ? '\n' + out : ''}`));
        });
        proc.once('error', (err) => {
          reject(new Error(`Не удалось запустить Xray: ${err.message}`));
        });
      });
      exited.catch(() => {});

      proc.stdout.on('data', (d) => { xrayOutput += d; this._log(d); });
      proc.stderr.on('data', (d) => { xrayOutput += d; this._log(d); });

      await Promise.race([waitPort(ports.socks, 12000), exited]);

      this.connected = true;
      this.startedAt = Date.now();
      this.lastError = '';
      for (const ses of this.sessions) {
        await this._applyProxy(ses, true);
      }
      this._emitSoon();
      return this.status();
    } catch (err) {
      let message = err.message;
      // Если причина ещё не содержит вывод Xray (например, таймаут waitPort),
      // добавим последние строки журнала — иначе пользователь видит только «код 23».
      if (!/Xray [0-9]/.test(message)) {
        const tail = this.logs.slice(-6).join(' | ');
        if (tail) message += ` · ${tail}`;
      }
      if (process.platform === 'darwin') {
        message += ' · Проверьте, что resources/xray/xray собран для arm64, имеет права на запуск и не заблокирован карантином (xattr -dr com.apple.quarantine /Applications/ArchBrowser.app).';
      }
      this.lastError = message;
      this.connected = false;
      if (proc) {
        try {
          proc.kill();
        } catch {}
        this.proc = null;
      }
      for (const ses of this.sessions) {
        await this._applyProxy(ses, false);
      }
      throw new Error(message);
    } finally {
      this.connecting = false;
      this._emitSoon();
    }
  }

  async disconnect() {
    this.stopping = true;
    const wasConnected = this.connected;
    this.connected = false;
    this.startedAt = 0;
    const proc = this.proc;
    this.proc = null;
    if (proc) {
      try {
        proc.kill();
      } catch {}
    }
    for (const ses of this.sessions) {
      await this._applyProxy(ses, false);
    }
    this.stopping = false;
    this._emitSoon();
    return wasConnected ? this.status() : this.status();
  }

  // PAC-скрипт вместо простого списка исключений: так можно отправить через
  // VPN отдельный сайт, который «напрямую» не открывается (типичная ситуация,
  // когда провайдер режет .ru/.рф по SNI), и при этом остальные сайты .ru/.рф
  // оставить прямыми.
  _buildPac(port) {
    const bypassRu = !!this.getSettings().vpnBypassRu;
    const viaVpn = JSON.stringify([...this.directFailed]);
    const proxy = `SOCKS5 127.0.0.1:${port}`;
    return [
      '// ArchBrowser: сгенерировано автоматически, не редактировать.',
      'function FindProxyForURL(url, host) {',
      `  var proxy = ${JSON.stringify(proxy)};`,
      `  var viaVpn = ${viaVpn};`,
      "  host = String(host || '').toLowerCase();",
      "  if (!host || host === 'localhost' || host.indexOf('127.') === 0 || host === '[::1]' || host === '::1') return 'DIRECT';",
      '  var i, d;',
      '  for (i = 0; i < viaVpn.length; i++) {',
      '    d = viaVpn[i];',
      "    if (host === d || host.slice(-(d.length + 1)) === '.' + d) return proxy;",
      '  }',
      `  if (${bypassRu ? 'true' : 'false'}) {`,
      "    if (host === 'ru' || host.slice(-3) === '.ru') return 'DIRECT';",
      "    if (host === 'xn--p1ai' || host.slice(-9) === '.xn--p1ai') return 'DIRECT';",
      "    if (host === 'рф' || host.slice(-3) === '.рф') return 'DIRECT';",
      '  }',
      '  return proxy;',
      '}',
      '',
    ].join('\n');
  }

  async _applyProxy(ses, enabled) {
    try {
      if (enabled && this.connected && this.runtimeSocksPort) {
        // ВАЖНО: PAC задаём data:-ссылкой. file:// в этой сборке Electron
        // не загружается (ERR_MANDATORY_PROXY_CONFIGURATION_FAILED).
        const pac = Buffer.from(this._buildPac(this.runtimeSocksPort), 'utf8').toString('base64');
        await ses.setProxy({
          mode: 'pac_script',
          pacScript: 'data:application/x-ns-proxy-autoconfig;base64,' + pac,
        });
      } else {
        await ses.setProxy({ mode: 'direct' });
      }
      await ses.closeAllConnections();
    } catch (err) {
      console.error('[vpn] applyProxy:', err.message);
    }
  }

  // Сайт из «прямого» списка не открылся — направляем его (и поддомены)
  // через VPN. Возвращает true, если правила изменились и имеет смысл
  // повторить загрузку страницы.
  async markDirectFailure(url, { force = false } = {}) {
    if (!this.connected || !this.runtimeSocksPort) return false;
    if (!this.getSettings().vpnBypassRu) return false;
    let host;
    try {
      host = new URL(String(url)).hostname.toLowerCase();
    } catch {
      return false;
    }
    if (!isDirectBypassHost(host)) return false;
    const key = host.replace(/^www\./, '');
    if (this.directFailed.has(key)) {
      if (!force) return false;
      // Уже отмечен, но пользователь просит ещё раз — просто применим правила.
      await this.refreshProxy();
      return true;
    }
    this.directFailed.add(key);
    if (this.directFailed.size > 400) {
      const first = this.directFailed.values().next().value;
      this.directFailed.delete(first);
    }
    await this.refreshProxy();
    return true;
  }

  // Переприменяет настройки прокси при смене «.ru напрямую» без
  // переподключения Xray.
  async refreshProxy() {
    if (!this.connected) return;
    for (const ses of this.sessions) {
      await this._applyProxy(ses, true);
    }
  }

  // Быстрая проверка «туннель ещё жив?». Пробуем два адреса: если оба не
  // ответили, считаем, что VPN завис (процесс есть, трафика нет).
  async _quickCheck(ses) {
    const probe = (url) =>
      new Promise((resolve) => {
        let done = false;
        const timer = setTimeout(() => {
          if (done) return;
          done = true;
          resolve(false);
        }, 4500);
        const finish = (value) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(value);
        };
        try {
          const req = electronNet.request({ method: 'GET', url, session: ses });
          req.on('response', (res) => {
            res.on('data', () => {});
            res.on('end', () => finish(res.statusCode >= 200 && res.statusCode < 400));
            res.on('error', () => finish(false));
          });
          req.on('error', () => finish(false));
          req.end();
        } catch {
          finish(false);
        }
      });
    if (await probe('https://www.gstatic.com/generate_204')) return true;
    return probe('https://api.ipify.org');
  }

  // Xray может остаться запущенным, но перестать передавать трафик (умер
  // удалённый сервер). Тогда все страницы «не грузятся», а индикатор VPN
  // зелёный. Возвращаем браузер на прямое соединение, чтобы он ожил.
  async recoverIfDead() {
    if (!this.connected) return false;
    const ses = [...this.sessions][0];
    if (!ses) return false;
    if (await this._quickCheck(ses)) return false;
    this.connected = false;
    this.startedAt = 0;
    this.lastError = 'Туннель не отвечает — включено прямое соединение';
    const proc = this.proc;
    this.proc = null;
    if (proc) {
      try {
        proc.kill();
      } catch {}
    }
    for (const s of this.sessions) {
      await this._applyProxy(s, false);
    }
    this._emitSoon();
    return true;
  }

  async testLatency(id) {
    const server = this.servers().find((s) => s.id === id);
    if (!server) throw new Error('Сервер не найден');
    const result = await tcpLatency(server.address, server.port);
    const servers = this.servers().map((s) =>
      s.id === id ? { ...s, latency: result.ok ? result.ms : null, latencyError: result.ok ? null : result.error } : s,
    );
    this.store.set({ servers });
    this._emitSoon();
    return result;
  }

  async testConnection() {
    if (!this.connected) return { ok: false, error: 'VPN не подключён' };
    const ses = [...this.sessions][0];
    if (!ses) return { ok: false, error: 'Нет активной сессии' };
    const started = Date.now();
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => finish({ ok: false, error: 'таймаут' }), 12000);
      try {
        const req = electronNet.request({
          method: 'GET',
          url: 'https://www.gstatic.com/generate_204',
          session: ses,
        });
        req.on('response', (res) => {
          res.on('data', () => {});
          res.on('end', async () => {
            const ok = res.statusCode >= 200 && res.statusCode < 400;
            const result = { ok, status: res.statusCode, ms: Date.now() - started };
            if (ok) {
              // Внешний IP — полезная диагностика: видно, что трафик идёт
              // через туннель, а не напрямую.
              const ip = await this._fetchText(ses, 'https://api.ipify.org', 6000).catch(() => '');
              if (ip && /^[0-9a-f.:]+$/i.test(ip.trim())) result.ip = ip.trim();
            }
            finish(result);
          });
        });
        req.on('error', (err) => finish({ ok: false, error: err.message }));
        req.end();
      } catch (err) {
        finish({ ok: false, error: err.message });
      }
    });
  }

  _fetchText(ses, url, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        reject(new Error('timeout'));
      }, timeoutMs);
      const finish = (value, err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (err) reject(err);
        else resolve(value);
      };
      try {
        const req = electronNet.request({ method: 'GET', url, session: ses });
        let body = '';
        req.on('response', (res) => {
          res.on('data', (chunk) => {
            body += chunk;
            if (body.length > 4096) body = body.slice(0, 4096);
          });
          res.on('end', () => finish(body));
          res.on('error', (err) => finish('', err));
        });
        req.on('error', (err) => finish('', err));
        req.end();
      } catch (err) {
        finish('', err);
      }
    });
  }

  async shutdown() {
    try {
      if (this.proc) this.proc.kill();
    } catch {}
    this.proc = null;
    this.connected = false;
  }
}

module.exports = { VpnManager, parseLink, extractLinks, buildOutbound, validateParsed };
