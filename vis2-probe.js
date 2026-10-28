'use strict';
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const tmp = path.join(os.tmpdir(), 'arch-vis2-' + Date.now());
fs.mkdirSync(tmp, { recursive: true });
fs.writeFileSync(path.join(tmp, 'settings.json'), JSON.stringify({ firstRun: false, doh: false }), 'utf8');
app.setPath('userData', tmp);
const main = require('D:/project/ArchBrowser/src/main.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[VIS2]', ...a);

app.whenReady().then(async () => {
  await sleep(5000);
  const ctrl = main.ctx.createWindow({ hidden: false });
  await sleep(2000);
  const a = ctrl.createTab('https://example.com/', { active: true });
  await sleep(2000);
  const b = ctrl.createTab('https://ru.wikipedia.org/', { active: true });
  await sleep(2000);
  const cv = ctrl._window.contentView;
  log('children', cv.children.length, 'visible', a.view.getVisible(), b.view.getVisible());
  log('bounds A', JSON.stringify(a.view.getBounds()), 'B', JSON.stringify(b.view.getBounds()));
  // 1) убрать B из дерева
  cv.removeChildView(b.view);
  await sleep(500);
  log('after removeChildView B: children', cv.children.length);
  const shot = await a.wc.capturePage();
  fs.writeFileSync('C:/Users/anger/AppData/Local/Temp/opencode/vis-removed.png', shot.toPNG());
  // 2) вернуть B и проверить z-order
  cv.addChildView(b.view);
  b.view.setBounds({ x: 0, y: 56, width: 1200, height: 800 });
  await sleep(800);
  const os_shot = 'C:/Users/anger/AppData/Local/Temp/opencode/vis-readd.png';
  const img = await ctrl._window.capturePage().catch(() => null);
  if (img) fs.writeFileSync(os_shot, img.toPNG());
  log('after re-add: children', cv.children.length);
  app.exit(0);
}).catch((e) => { log('FATAL', e && e.stack); app.exit(1); });
setTimeout(() => app.exit(2), 60000).unref();
