'use strict';

// Preload для всплывающего окна подсказок. Окно показывается поверх страницы,
// поэтому основная панель браузера не сдвигается — как в других браузерах.

const { contextBridge, ipcRenderer } = require('electron');

function applyTheme(theme) {
  if (!theme) return;
  const root = document.documentElement;
  const mode = theme.mode || (theme.dark ? 'dark' : 'light');
  root.dataset.theme = theme.name || 'original';
  root.dataset.mode = mode;
  root.style.colorScheme = mode;
  root.style.setProperty('--accent', theme.accent);
  root.style.setProperty('--accent-contrast', theme.accentContrast);
  if (theme.accent2) root.style.setProperty('--accent-2', theme.accent2);
}

contextBridge.exposeInMainWorld('archSuggest', {
  pick: (index) => ipcRenderer.send('suggestions:pick', index),
  dismiss: () => ipcRenderer.send('suggestions:dismiss'),
});

ipcRenderer.on('suggestions:html', (_event, html) => {
  const list = document.getElementById('list');
  if (!list) return;
  list.innerHTML = html || '';
  list.querySelectorAll('[data-suggest]').forEach((row) => {
    row.addEventListener('click', () => {
      ipcRenderer.send('suggestions:pick', Number(row.dataset.suggest));
    });
  });
  // Сообщаем размер, чтобы окно обрезалось по содержимому.
  requestAnimationFrame(() => {
    const height = Math.ceil(document.body.scrollHeight);
    ipcRenderer.send('suggestions:size', height);
  });
});

ipcRenderer.invoke('theme:get').then(applyTheme).catch(() => {});
