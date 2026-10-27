'use strict';
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const tmp = path.join(os.tmpdir(), 'arch-tabs2-' + Date.now());
fs.mkdirSync(tmp, { recursive: true });
fs.writeFileSync(path.join(tmp, 'settings.json'), JSON.stringify({ firstRun: false, doh: false }), 'utf8');
app.setPath('userData', tmp);
const main = require('D:/project/ArchBrowser/src/main.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[T2]', ...a);

app.whenReady().then(async () => {
  await sleep(5000);
  const ctrl = main.ctx.createWindow({ hidden: false });
  await sleep(2000);
  const a = ctrl.createTab('https://example.com/', { active: true });
  await sleep(2200);
  const b = ctrl.createTab('https://ru.wikipedia.org/', { active: true });
  await sleep(2200);

  const state = () => JSON.stringify({
    active: ctrl.activeId === a.id ? 'A' : 'B',
    attachedA: !!a.view.__archAttached,
    attachedB: !!b.view.__archAttached,
    children: ctrl._window.contentView.children.length,
    order: ctrl.order.map((id) => (id === a.id ? 'A' : 'B')).join(','),
  });
  log('create B:', state());
  ctrl.selectTab(a.id);
  await sleep(500);
  log('select A:', state());
  ctrl.selectTab(b.id);
  await sleep(500);
  log('select B:', state());

  // Панель: страницы должны исчезнуть из дерева
  ctrl.setUIMode('settings');
  await sleep(500);
  log('panel settings:', state());
  ctrl.setUIMode('web');
  await sleep(500);
  log('back to web:', state());

  // Переключение панелей плеера и торрента
  ctrl.setUIMode('player');
  await sleep(400);
  log('player panel:', state());
  ctrl.setUIMode('torrent');
  await sleep(400);
  log('torrent panel:', state());
  ctrl.setUIMode('web');
  await sleep(300);
  app.exit(0);
}).catch((e) => { log('FATAL', e && e.stack); app.exit(1); });
setTimeout(() => app.exit(2), 90000).unref();
