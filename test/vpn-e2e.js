'use strict';
// End-to-end VPN test:
// Electron session -> Xray socks inbound -> local SOCKS5 server -> local HTTP server.
// A fake domain (vpn-e2e.test) is only resolvable by the SOCKS5 server, so a successful
// response proves the whole proxy chain worked.
const { app, session } = require('electron');
const net = require('net');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { VpnManager } = require('../src/core/vpn');

const results = [];
function check(name, ok, extra = '') {
  results.push({ name, ok, extra });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`);
}

function startHttpServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('VPN-E2E-OK');
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

function startSocksServer(targetPort) {
  return new Promise((resolve) => {
    let connections = 0;
    const srv = net.createServer((client) => {
      client.once('data', (greeting) => {
        if (greeting[0] !== 0x05) return client.destroy();
        client.write(Buffer.from([0x05, 0x00]));
        client.once('data', (req) => {
          connections++;
          const atyp = req[3];
          let host;
          let offset;
          if (atyp === 0x01) {
            host = Array.from(req.subarray(4, 8)).join('.');
            offset = 8;
          } else if (atyp === 0x03) {
            const len = req[4];
            host = req.subarray(5, 5 + len).toString();
            offset = 5 + len;
          } else {
            return client.destroy();
          }
          const port = req.readUInt16BE(offset);
          const destPort = host === 'vpn-e2e.test' ? targetPort : port;
          const upstream = net.connect(destPort, '127.0.0.1', () => {
            client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 0]));
            upstream.pipe(client);
            client.pipe(upstream);
          });
          upstream.on('error', () => client.destroy());
          client.on('error', () => upstream.destroy());
        });
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port, count: () => connections }));
  });
}

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-vpn-e2e-'));
  const httpSrv = await startHttpServer();
  const socks = await startSocksServer(httpSrv.address().port);
  const ses = session.fromPartition('vpn-e2e-' + Date.now());
  const vpn = new VpnManager({
    resourcesDir: path.join(__dirname, '..', 'resources'),
    userDataDir: tmp,
    getSettings: () => ({ vpnSocksPort: 15808, vpnHttpPort: 15809 }),
  });

  try {
    vpn.registerSession(ses);
    const added = vpn.addFromText(`socks://127.0.0.1:${socks.port}#Local E2E`);
    check('server-added', added.added === 1, JSON.stringify(added.errors));

    const status = await vpn.connect();
    check('xray-connected', status.connected === true, `socks=${status.socksPort} http=${status.httpPort}`);
    check('ports-allocated', status.socksPort > 0 && status.httpPort > 0);

    const proxy = await ses.resolveProxy('http://vpn-e2e.test/');
    check('session-proxy-set', /SOCKS5?\s+127\.0\.0\.1:/i.test(proxy), proxy);

    const res = await ses.fetch('http://vpn-e2e.test/');
    const body = await res.text();
    check('proxied-request', res.status === 200 && body === 'VPN-E2E-OK', `${res.status} ${body}`);
    check('socks-used', socks.count() >= 1, `connections=${socks.count()}`);

    await vpn.disconnect();
    const after = await ses.resolveProxy('http://vpn-e2e.test/');
    check('proxy-cleared', /\bDIRECT\b/.test(after), after);

    check('xray-process-stopped', vpn.proc === null);
  } catch (err) {
    check('exception', false, err.stack || err.message);
  } finally {
    await vpn.shutdown();
    socks.srv.close();
    httpSrv.close();
    setTimeout(() => {
      const failed = results.filter((r) => !r.ok).length;
      console.log(failed ? `VPN_E2E_FAIL (${failed})` : 'VPN_E2E_OK');
      app.exit(failed ? 1 : 0);
    }, 500);
  }
}).catch((err) => {
  console.error('VPN_E2E_FAIL', err);
  app.exit(1);
});

setTimeout(() => {
  console.error('VPN_E2E_TIMEOUT');
  app.exit(1);
}, 45000).unref();
