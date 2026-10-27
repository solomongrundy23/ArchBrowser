'use strict';

const { app, BrowserWindow, session } = require('electron');
const http = require('http');
const path = require('path');

app.commandLine.appendSwitch(
  'host-resolver-rules',
  'MAP page.local 127.0.0.1, MAP ad.doubleclick.net 127.0.0.1',
);

let adHits = 0;
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/ad.js')) {
    adHits += 1;
    res.writeHead(200, { 'content-type': 'application/javascript' });
    res.end('window.__adLoaded = true;');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html><title>uBO Lite test</title>
    <script>
      window.__adStatus = 'pending';
      const s = document.createElement('script');
      s.src = 'http://ad.doubleclick.net:18080/ad.js';
      s.onload = () => { window.__adStatus = 'loaded'; };
      s.onerror = () => { window.__adStatus = 'blocked'; };
      document.head.appendChild(s);
    </script>`);
});

app.whenReady().then(async () => {
  await new Promise((r) => server.listen(18080, '127.0.0.1', r));
  const ses = session.defaultSession;
  const ext = await (ses.extensions || ses).loadExtension(
    path.join(__dirname, '..', 'resources', 'extensions', 'ublock-origin-lite'),
    { allowFileAccess: true },
  );
  console.log('EXT', ext.id);
  await new Promise((r) => setTimeout(r, 3000));

  const win = new BrowserWindow({ width: 800, height: 600, show: false });
  await win.loadURL('http://page.local:18080/');
  await new Promise((r) => setTimeout(r, 4000));
  const status = await win.webContents.executeJavaScript(
    '({ adStatus: window.__adStatus, adLoaded: !!window.__adLoaded })',
  ).catch((err) => ({ error: err.message }));
  console.log('RESULT', JSON.stringify({ status, adHits }));
  server.close();
  app.exit(adHits === 0 && status.adStatus === 'blocked' ? 0 : 1);
});
