'use strict';

// Встраивает иконку ArchBrowser в electron.exe, чтобы при запуске из
// исходников (start.bat, ArchBrowser.vbs, npm start) на панели задач была
// иконка браузера, а не стандартная иконка Electron.
//
// Запускается автоматически после npm install. Если rcedit или electron.exe
// ещё нет, установка не прерывается.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

if (process.platform !== 'win32') process.exit(0);

const root = path.resolve(__dirname, '..');
const electronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const icon = path.join(root, 'assets', 'icon.ico');
const rcedit = path.join(__dirname, 'rcedit.exe');

for (const file of [electronExe, icon, rcedit]) {
  if (!fs.existsSync(file)) {
    console.log(`[icon] пропущено: нет ${path.relative(root, file)}`);
    process.exit(0);
  }
}

try {
  const result = spawnSync(rcedit, [electronExe, '--set-icon', icon], {
    windowsHide: true,
    stdio: 'pipe',
  });
  if (result.status === 0) {
    console.log('[icon] иконка ArchBrowser встроена в electron.exe');
  } else {
    console.warn('[icon] rcedit не смог изменить electron.exe:', String(result.stderr || '').trim());
  }
} catch (err) {
  console.warn('[icon] не удалось изменить electron.exe:', err.message);
}
