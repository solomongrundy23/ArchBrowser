'use strict';

// Собирает assets/icon.png и assets/icon.ico из assets/angel.png.
// Запуск: node_modules/electron/dist/electron.exe scripts/build-icons.js
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

function buildIco(images, sizes) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + 16 * images.length;
  const entries = [];
  for (let i = 0; i < images.length; i += 1) {
    const size = sizes[i];
    const data = images[i];
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...images]);
}

app.whenReady().then(() => {
  const logFile = path.join(ROOT, 'assets', 'build-icons.log');
  const log = (...args) => fs.appendFileSync(logFile, args.join(' ') + '\n');
  fs.writeFileSync(logFile, '');
  try {
    const image = nativeImage.createFromPath(path.join(ROOT, 'assets', 'angel.png'));
    if (image.isEmpty()) throw new Error('assets/angel.png is empty');
    log('loaded', JSON.stringify(image.getSize()));
    image.resize({ width: 512, height: 512, quality: 'best' }).toPNG();
    fs.writeFileSync(
      path.join(ROOT, 'assets', 'icon.png'),
      image.resize({ width: 512, height: 512, quality: 'best' }).toPNG(),
    );

    const pngs = SIZES.map((size) =>
      image.resize({ width: size, height: size, quality: 'best' }).toPNG(),
    );
    fs.writeFileSync(path.join(ROOT, 'assets', 'icon.ico'), buildIco(pngs, SIZES));
    log('icon.png + icon.ico done');
    app.exit(0);
  } catch (err) {
    log('ERROR', err && err.stack ? err.stack : String(err));
    app.exit(1);
  }
});
