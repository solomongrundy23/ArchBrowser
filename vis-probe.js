'use strict';
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const tmp = path.join(os.tmpdir(), 'arch-vis-' + Date.now());
fs.mkdirSync(tmp, { recursive: true });
fs.writeFileSync(path.join(tmp, 'settings.json'), JSON.stringify({ firstRun: false, doh: false }), 'utf8');
app.setPath('userData', tmp);
const main = require('D:/project/ArchBrowser/src/main.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[VIS]', ...a);

app.whenReady().then(async () => {
  await sleep(5000);
  const ctrl = main.ctx.createWindow({ hidden: false });
  await sleep(2000);
  const a = ctrl.createTab('https://example.com/', { active: true });
  await sleep(2000);
  const b = ctrl.createTab('https://ru.wikipedia.org/', { active: true });
  await sleep(2000);
  log('before', 'A=', a.view.getVisible(), 'B=', b.view.getVisible());
  try { b.view.setVisible(false); } catch (e) { log('setVisible error', e.message); }
  await sleep(300);
  log('after hide B', 'A=', a.view.getVisible(), 'B=', b.view.getVisible());
  try { ctrl._updateVisibility(); } catch (e) { log('updateVisibility error', e.stack); }
  await sleep(300);
  log('after _updateVisibility', 'A=', a.view.getVisible(), 'B=', b.view.getVisible(), 'uiMode=', ctrl.uiMode, 'active=', ctrl.activeId === a.id ? 'A' : 'B');
  log('children', ctrl._window.contentView.children.length);
  app.exit(0);
}).catch((e) => { log('FATAL', e && e.stack); app.exit(1); });
setTimeout(() => app.exit(2), 60000).unref();
