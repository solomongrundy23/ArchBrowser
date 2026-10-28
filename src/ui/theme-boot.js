'use strict';

// Применяем системную тему и акцент до первой отрисовки интерфейса,
// чтобы не было вспышки тёмной темы в светлой (и наоборот).
(() => {
  const theme = window.arch && window.arch.initialTheme;
  if (!theme) return;
  const root = document.documentElement;
  const mode = theme.mode || (theme.dark ? 'dark' : 'light');
  root.dataset.theme = theme.name || 'original';
  root.dataset.mode = mode;
  root.dataset.appearance = theme.appearance || 'system';
  root.style.colorScheme = mode;
  root.style.setProperty('--accent', theme.accent);
  root.style.setProperty('--accent-contrast', theme.accentContrast);
  if (theme.accent2) root.style.setProperty('--accent-2', theme.accent2);
})();
