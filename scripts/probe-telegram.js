'use strict';

const { app, BrowserWindow, session } = require('electron');

app.whenReady().then(async () => {
  const ses = session.fromPartition('probe-telegram-' + Date.now());
  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 800,
    webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await win.loadURL('https://web.telegram.org/a/#/settings');
  await new Promise((r) => setTimeout(r, 10000));
  try {
    const result = await win.webContents.executeJavaScript(`(async () => {
      const res = performance.getEntriesByType('resource').map(e => e.name).filter(n => /assets\\/.*\\.js/.test(n));
      const text = document.body.innerText.slice(0, 3000);
      const html = document.body.innerHTML.slice(0, 5000);
      return { res: [...new Set(res)], text, html };
    })()`);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('PROBE_ERROR', err.message);
  }
  app.exit(0);
});
