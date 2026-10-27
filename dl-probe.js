'use strict';
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

const tmp = path.join(os.tmpdir(), 'arch-dl-' + Date.now());
const dlDir = path.join(tmp, 'downloads');
fs.mkdirSync(tmp, { recursive: true });
fs.writeFileSync(path.join(tmp, 'settings.json'), JSON.stringify({ firstRun: false, doh: false, downloadDir: dlDir }), 'utf8');
app.setPath('userData', tmp);
const main = require('D:/project/ArchBrowser/src/main.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[DL]', ...a);

const BODY = Buffer.alloc(400 * 1024, 7);

app.whenReady().then(async () => {
  const srv = http.createServer((req, res) => {
    if (req.url.startsWith('/file.bin')) {
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': BODY.length,
        'content-disposition': 'attachment; filename="test-file.bin"',
      });
      res.end(BODY);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<a id="dl" href="/file.bin">download</a>');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;

  await sleep(5000);
  const ctrl = main.ctx.createWindow({ hidden: false });
  await sleep(1500);
  const tab = ctrl.createTab(`http://127.0.0.1:${port}/`, { active: true });
  await sleep(1500);
  log('page title', tab.title);
  await tab.wc.executeJavaScript('document.getElementById("dl").click()').catch((e) => log('click error', e.message));
  for (let i = 0; i < 8; i++) {
    await sleep(1000);
    const list = main.ctx.downloads || [];
    log(`+${i + 1}s`, 'downloads:', list.length, list[0] ? `${list[0].state} ${list[0].received}/${list[0].total} ${list[0].filename}` : '');
    if (list[0] && list[0].state !== 'progressing') break;
  }
  const files = fs.existsSync(dlDir) ? fs.readdirSync(dlDir, { withFileTypes: true }).map((d) => d.name) : [];
  log('files in dir', JSON.stringify(files));
  srv.close();
  app.exit(0);
}).catch((e) => { log('FATAL', e && e.stack); app.exit(1); });
setTimeout(() => app.exit(2), 60000).unref();
