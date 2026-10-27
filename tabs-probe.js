'use strict';
// Переключение вкладок: какие view видимы.
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const tmp = path.join(os.tmpdir(), 'arch-tabs-' + Date.now());
fs.mkdirSync(tmp, { recursive: true });
fs.writeFileSync(path.join(tmp, 'settings.json'), JSON.stringify({ firstRun: false, doh: false }), 'utf8');
app.setPath('userData', tmp);
const main = require('D:/project/ArchBrowser/src/main.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[TABS]', ...a);

app.whenReady().then(async () => {
  await sleep(5000);
  const ctrl = main.ctx.createWindow({ hidden: false });
  await sleep(2000);
  const a = ctrl.createTab('https://example.com/', { active: true });
  await sleep(2500);
  const b = ctrl.createTab('https://ru.wikipedia.org/', { active: true });
  await sleep(2500);

  const state = () => ({
    active: ctrl.activeId === a.id ? 'A' : ctrl.activeId === b.id ? 'B' : '?',
    splitL: ctrl.splitLeftId ? (ctrl.splitLeftId === a.id ? 'A' : 'B') : null,
    splitR: ctrl.splitRightId ? (ctrl.splitRightId === a.id ? 'A' : 'B') : null,
    visibleA: (() => { try { return a.view.getVisible(); } catch (e) { return 'n/a'; } })(),
    visibleB: (() => { try { return b.view.getVisible(); } catch (e) { return 'n/a'; } })(),
    order: ctrl.order.map((id) => (id === a.id ? 'A' : 'B')).join(','),
  });
  log('after create B', JSON.stringify(state()));

  ctrl.selectTab(a.id);
  await sleep(400);
  log('after select A', JSON.stringify(state()));

  ctrl.selectTab(b.id);
  await sleep(400);
  log('after select B', JSON.stringify(state()));

  // Проверяем, что реально на экране: снимок активной вкладки и обеих.
  const shotA = await a.wc.capturePage();
  fs.writeFileSync('C:/Users/anger/AppData/Local/Temp/opencode/tabs-a.png', shotA.toPNG());
  app.exit(0);
}).catch((e) => { log('FATAL', e && e.stack); app.exit(1); });
setTimeout(() => app.exit(2), 90000).unref();
