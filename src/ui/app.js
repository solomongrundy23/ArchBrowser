'use strict';

/* eslint-disable no-undef */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// macOS: Liquid Glass и отступ под «светофоры» окна.
const IS_MAC = /Mac/i.test(navigator.platform) || /Mac OS X/i.test(navigator.userAgent);

const esc = (value) =>
  String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));

const icon = (name, cls = '') => `<svg class="icon ${cls}"><use href="#i-${name}"/></svg>`;

// Обновляет только ссылку на символ, не пересоздавая SVG. Перерисовка
// innerHTML у кнопок на каждом timeupdate приводила к тому, что нажатие
// «проглатывалось»: mousedown попадал в старый узел, а click — уже в новый.
function setIcon(el, name) {
  if (!el) return;
  const href = `#i-${name}`;
  const use = el.querySelector('use');
  if (use) {
    if (use.getAttribute('href') !== href) use.setAttribute('href', href);
    return;
  }
  if (el.dataset.icon !== name) {
    el.innerHTML = icon(name);
    el.dataset.icon = name;
  }
}

// Русские склонения по числу: plural(1, 'пароль', 'пароля', 'паролей').
const plural = (count, one, few, many) => {
  const n = Math.abs(Math.round(Number(count) || 0));
  const mod10 = n % 10;
  const mod100 = n % 100;
  const text = n.toLocaleString('ru-RU');
  if (mod10 === 1 && mod100 !== 11) return `${text} ${one}`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${text} ${few}`;
  return `${text} ${many}`;
};

const S = {
  data: null,
  mode: 'web',
  dock: null,
  suggestions: [],
  selected: -1,
  find: { text: '', matches: 0, active: 0 },
  vpnJson: '',
  panelToken: 0,
  panelRequestedAt: 0,
  pendingMode: null,
  panelConfirmTimer: null,
  tabEls: new Map(),
  toastTimer: null,
  dragId: null,
  layoutTimer: null,
  bootDone: false,
  importBrowsers: null,
  importBusy: false,
  passwords: null,
  fullscreen: false,
  panelPointerDown: false,
  mediaBarVisible: null,
};

const ENGINES = [
  ['duckduckgo', 'DuckDuckGo'],
  ['startpage', 'Startpage'],
  ['brave', 'Brave Search'],
  ['google', 'Google'],
  ['yandex', 'Яндекс'],
];

const DOH_SERVERS = [
  ['https://cloudflare-dns.com/dns-query', 'Cloudflare (1.1.1.1)'],
  ['https://dns.quad9.net/dns-query', 'Quad9 (9.9.9.9)'],
  ['https://dns.adguard-dns.com/dns-query', 'AdGuard DNS'],
  ['https://dns.google/dns-query', 'Google DNS'],
];

// Темы оформления. Список синхронизируется с src/core/themes.js.
// Светлый/тёмный режим — отдельная настройка, у каждой темы есть оба варианта.
const THEMES_LIST = [
  ['original', 'Оригинальная'],
  ['accent', 'Акцентная'],
  ['cyberpunk', 'Киберпанк'],
  ['neon', 'Неон'],
  ['umbrella', 'Umbrella Corp'],
  ['gold', 'Золото'],
  ['silver', 'Серебро'],
  ['amoled', 'AMOLED'],
  ['silenthill', 'Silent Hill'],
  ['newyear', 'Новый год'],
  ['christmas', 'Рождество'],
  ['feb14', 'День всех влюблённых'],
  ['feb23', 'День защитника Отечества'],
  ['mar8', 'Международный женский день'],
  ['may1', 'Праздник Весны и Труда'],
  ['may9', 'День Победы'],
  ['jun12', 'День России'],
  ['nov4', 'День народного единства'],
  ['halloween', 'Хэллоуин'],
  ['winter', 'Зима'],
  ['summer', 'Лето'],
  ['autumn', 'Осень'],
  ['spring', 'Весна'],
];

const APPEARANCE_LIST = [
  ['system', 'Как в системе'],
  ['light', 'Светлая'],
  ['dark', 'Тёмная'],
];

const PANEL_META = {
  settings: { title: 'Настройки', icon: 'settings' },
  vpn: { title: 'VPN', icon: 'shield' },
  extensions: { title: 'Расширения', icon: 'puzzle' },
  history: { title: 'История', icon: 'history' },
  bookmarks: { title: 'Закладки', icon: 'bookmark' },
  downloads: { title: 'Загрузки', icon: 'download' },
  player: { title: 'Плеер', icon: 'music' },
  torrent: { title: 'Загрузки torrent', icon: 'torrent' },
  about: { title: 'О браузере', icon: 'info' },
};

const activeTab = () => (S.data ? S.data.activeTab : null);

function fmtBytes(bytes) {
  if (!bytes) return '0 Б';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}

function fmtTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function fmtDate(ts) {
  try {
    return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return '';
  }
}

function fmtUptime(seconds) {
  if (!seconds) return '0 с';
  if (seconds < 60) return `${seconds} с`;
  const m = Math.floor(seconds / 60);
  const h = Math.floor(m / 60);
  if (h) return `${h} ч ${m % 60} мин`;
  return `${m} мин`;
}

function dayLabel(ts) {
  const now = new Date();
  const d = new Date(ts);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((today - that) / 86400000);
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url || '';
  }
}

function cleanError(err) {
  let msg = err && err.message ? err.message : String(err);
  msg = msg.replace(/^Error invoking remote method '[^']+':\s*/i, '');
  msg = msg.replace(/^Error:\s*/i, '');
  return msg || 'Неизвестная ошибка';
}

function toast(message, type = 'info') {
  const text = String(message == null ? '' : message).trim();
  if (!text) return;
  // Сообщения показываются отдельным окном поверх страницы: обычный div
  // в окне интерфейса оказывается ПОД нативным слоем сайта.
  try {
    const pending = window.arch.invoke('ui:toast', { message: text, type });
    if (pending && pending.catch) pending.catch(() => {});
    return;
  } catch {}
  const el = $('#toast');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('error', type === 'error');
  el.classList.remove('hidden');
  clearTimeout(S.toastTimer);
  S.toastTimer = setTimeout(() => el.classList.add('hidden'), type === 'error' ? 6500 : 3500);
}

async function invoke(channel, payload) {
  return window.arch.invoke(channel, payload);
}

/* ------------------------------------------------------------------ theme / titlebar */
function applyTheme(theme) {
  if (!theme) return;
  const root = document.documentElement;
  // data-theme — выбранная тема (original, accent, cyberpunk…),
  // data-mode — светлый или тёмный вариант, независимый от темы.
  const mode = theme.mode || (theme.dark ? 'dark' : 'light');
  root.dataset.theme = theme.name || 'original';
  root.dataset.mode = mode;
  root.dataset.appearance = theme.appearance || 'system';
  root.style.colorScheme = mode;
  root.style.setProperty('--accent', theme.accent);
  root.style.setProperty('--accent-contrast', theme.accentContrast);
  if (theme.accent2) root.style.setProperty('--accent-2', theme.accent2);
  else root.style.removeProperty('--accent-2');
  // Отдельный класс: раньше здесь был «festive», и стили новогоднего
  // блока (.festive) случайно применялись к самому <html>.
  root.classList.toggle('festive-theme', !!theme.festive);
}

// Резервируем место под кнопки «свернуть/развернуть/закрыть» в строке вкладок.
function setupTitlebar() {
  const root = document.documentElement;
  const overlay = navigator.windowControlsOverlay;
  if (!overlay) {
    root.style.setProperty('--wco-width', '0px');
    return;
  }
  const update = () => {
    try {
      if (!overlay.visible) {
        root.style.setProperty('--wco-width', '0px');
        return;
      }
      const rect = overlay.getTitlebarAreaRect();
      const right = Math.max(0, window.innerWidth - rect.x - rect.width);
      root.style.setProperty('--wco-width', `${Math.round(right)}px`);
    } catch {
      root.style.setProperty('--wco-width', '138px');
    }
  };
  overlay.addEventListener('geometrychange', update);
  window.addEventListener('resize', update);
  update();
}

/* ------------------------------------------------------------------ boot */
function setBootProgress(status) {
  if (!status) return;
  const bar = $('#boot-bar');
  const phase = $('#boot-phase');
  if (phase) phase.textContent = status.phase || 'Запуск…';
  if (bar) {
    const total = Math.max(1, Number(status.total) || 1);
    const done = Math.max(0, Number(status.done) || 0);
    const percent = status.ready ? 100 : Math.min(96, Math.round((done / total) * 100));
    bar.style.width = `${percent}%`;
  }
}

let bootFinished = false;
function finishBoot() {
  if (bootFinished) return;
  bootFinished = true;
  S.bootDone = true;
  const boot = $('#boot');
  if (boot) {
    boot.classList.add('boot-done');
    setTimeout(() => boot.remove(), 460);
  }
  invoke('boot:done').catch(() => {});
}

async function initBoot() {
  try {
    const started = Date.now();
    const poll = async () => {
      let status = null;
      try {
        status = await invoke('app:ready');
      } catch {}
      if (status) {
        setBootProgress(status);
        if (status.ready) {
          // Не мигаем заставкой на быстром запуске.
          const wait = Math.max(0, 700 - (Date.now() - started));
          setTimeout(finishBoot, wait);
          return;
        }
      }
      if (!bootFinished) setTimeout(poll, 260);
    };
    poll();
  } catch {
    setTimeout(finishBoot, 1200);
  }
}

/* ------------------------------------------------------------------ init */
document.addEventListener('DOMContentLoaded', () => {
  document.body.classList.toggle('platform-mac', IS_MAC);
  setupTitlebar();
  initBoot();
  bindChrome();
  bindPanel();
  window.arch.onState(onState);
  window.arch.onCommand(onCommand);
  window.arch.onFindResult(onFindResult);

  invoke('state:get')
    .then((data) => {
      if (data) onState(data);
      else setTimeout(() => invoke('state:get').then((d) => d && onState(d)), 120);
    })
    .catch((err) => toast(cleanError(err), 'error'));

  const chrome = $('#chrome');
  const sendLayout = () => {
    clearTimeout(S.layoutTimer);
    S.layoutTimer = setTimeout(() => {
      const chromeRect = chrome.getBoundingClientRect();
      const tabstripRect = $('#tabstrip').getBoundingClientRect();
      // Панель раздела должна начинаться ровно под всей шапкой: с панелью
      // закладок и верхним пультом она выше стандартных 92 px.
      document.documentElement.style.setProperty('--panel-top', `${Math.round(chromeRect.height)}px`);
      const position = document.body.dataset.tabs || 'top';
      const fullscreen = document.body.classList.contains('browser-fullscreen');
      const mediaBar = $('#media-bar');
      // chromeRect.bottom включает открытый док/меню во всех раскладках,
      // поэтому страница не перекрывает его нативным WebContentsView.
      const rect = {
        height: chromeRect.height,
        top: chromeRect.bottom,
        left: 0,
        right: 0,
        bottom: 0,
      };
      if (position === 'left') {
        rect.left = tabstripRect.width;
      } else if (position === 'right') {
        rect.right = tabstripRect.width;
      } else if (position === 'bottom') {
        rect.bottom = tabstripRect.height;
      }
      if (fullscreen) {
        // В полноэкранном режиме нижний пульт тоже резервирует место.
        if (mediaBar && !mediaBar.classList.contains('hidden')) {
          rect.bottom = Math.max(rect.bottom, Math.round(mediaBar.getBoundingClientRect().height || 44));
        }
      }
      // Пульт снизу — отдельный фиксированный слой поверх страницы.
      const mediaBottom = document.body.classList.contains('media-bar-bottom') &&
        !document.body.classList.contains('browser-fullscreen') &&
        mediaBar && !mediaBar.classList.contains('hidden');
      if (mediaBottom) {
        rect.bottom += Math.round(mediaBar.getBoundingClientRect().height || 40);
      }
      invoke('ui:chrome-layout', rect).catch(() => {});
    }, 25);
  };
  new ResizeObserver(sendLayout).observe(chrome);
  new ResizeObserver(sendLayout).observe($('#tabstrip'));
  window.addEventListener('resize', () => {
    syncDockGeometry();
    sendLayout();
  });
  sendLayout();
  S.sendLayout = sendLayout;
});

function applyTabPosition(position) {
  const value = ['top', 'bottom', 'left', 'right'].includes(position) ? position : 'top';
  document.body.dataset.tabs = value;
  document.documentElement.dataset.tabs = value;
  if (S.sendLayout) S.sendLayout();
}

// Пульт медиа можно закрепить сверху (под панелью инструментов) или снизу
// окна. Низ — отдельный фиксированный слой, поэтому странице нужно отдать
// нижний отступ.
function applyMediaBarPosition(position) {
  const value = position === 'bottom' ? 'bottom' : 'top';
  document.body.classList.toggle('media-bar-bottom', value === 'bottom');
  document.body.classList.toggle('media-bar-top', value === 'top');
  const bar = $('#media-bar');
  if (bar) bar.dataset.position = value;
}
function scheduleChromeLayout() {
  if (S.sendLayout) S.sendLayout();
}

function onState(data) {
  const prevMode = S.mode;
  S.data = data;
  applyTheme(data.theme);
  document.body.classList.toggle('private', !!data.isPrivate);
  S.fullscreen = !!data.browserFullscreen;
  document.body.classList.toggle('browser-fullscreen', S.fullscreen);
  document.body.classList.toggle('fs-bar', S.fullscreen && !!data.fullscreenBar);
  document.body.classList.toggle('fs-media', S.fullscreen && !!data.fullscreenMedia);
  applyMediaBarPosition(data.settings && data.settings.mediaBarPosition);
  applyTabPosition(data.settings && data.settings.tabPosition);

  renderTabs();
  renderToolbar();
  renderVpnChip();
  renderDownloadBadge();
  renderTimerChips();
  renderBookmarksBar();
  updateMediaBar();
  updatePlayerPanel();
  // Скрытая панель кнопок справа от адресной строки.
  const compactToolbar = !!(data.settings && data.settings.compactToolbar);
  document.body.classList.toggle('toolbar-collapsed', compactToolbar);
  const collapseBtn = $('#toolbar-collapse');
  const expandBtn = $('#toolbar-expand');
  if (collapseBtn) collapseBtn.classList.toggle('hidden', compactToolbar);
  if (expandBtn) expandBtn.classList.toggle('hidden', !compactToolbar);
  // Кнопки дополнительных функций прячутся, если функция отключена.
  const featureButtons = [
    ['#player-btn', data.settings && data.settings.featureLocalPlayer !== false],
    ['#torrent-btn', data.settings && data.settings.featureBittorrent !== false],
  ];
  for (const [selector, shown] of featureButtons) {
    const btn = $(selector);
    if (btn) btn.classList.toggle('hidden', !shown);
  }
  scheduleChromeLayout();

  // Главный процесс подтвердил запрошенный режим — рисуем панель.
  if (data.uiMode && data.uiMode === S.pendingMode) {
    S.pendingMode = null;
    clearTimeout(S.panelConfirmTimer);
    if (S.mode !== data.uiMode) {
      S.mode = data.uiMode;
      $('#panel').classList.remove('hidden');
      renderPanel(S.mode);
    }
    return;
  }
  if (data.uiMode && data.uiMode !== S.mode && !S.pendingMode) {
    // Режим сменил главный процесс (например, пункт меню).
    S.mode = data.uiMode;
    if (S.mode === 'web') hidePanel();
    else {
      $('#panel').classList.remove('hidden');
      renderPanel(S.mode);
    }
  }

  if (prevMode !== S.mode) {
    // панель уже отрисована выше
  }

  if (S.mode === 'vpn') {
    const json = JSON.stringify(data.vpn);
    if (json !== S.vpnJson && !panelInputFocused() && !S.panelPointerDown) {
      S.vpnJson = json;
      renderPanel('vpn');
    }
  } else if (S.mode === 'downloads') {
    // Пока кнопка панели нажата, не пересобираем список: иначе узел под
    // курсором исчезает между mousedown и click и нажатие «не срабатывает».
    if (!panelInputFocused() && !S.panelPointerDown) renderPanel('downloads');
  } else if (S.mode === 'about' || S.mode === 'settings') {
    // статические данные не перерисовываем, чтобы не сбить ввод
  }
}

function panelInputFocused() {
  const active = document.activeElement;
  if (!active) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) && $('#panel').contains(active);
}

/* ------------------------------------------------------------------ tabs */
function animateTabClose(el) {
  if (!el || !el.isConnected) return;
  const parent = el.parentElement;
  const rect = el.getBoundingClientRect();
  const vertical = getComputedStyle(parent).flexDirection === 'column';
  el.classList.remove('tab-new');
  el.classList.add('tab-closing');
  el.style.width = `${rect.width}px`;
  el.style.height = `${rect.height}px`;
  el.style.flex = '0 0 auto';
  el.style.minWidth = '0';
  el.style.maxWidth = 'none';

  // Анимация заметно сжимает вкладку и уносит её вверх, а не просто гасит
  // прозрачность. Соседние вкладки плавно занимают освободившееся место.
  const frames = vertical
    ? [
        {
          opacity: 1,
          height: `${rect.height}px`,
          paddingTop: '0px',
          paddingBottom: '0px',
          marginTop: '0px',
          marginBottom: '0px',
          transform: 'translateY(0) scale(1)',
          filter: 'blur(0)',
        },
        {
          opacity: 1,
          offset: .3,
          transform: 'translateY(2px) scale(.96)',
        },
        {
          opacity: 0,
          height: '0px',
          paddingTop: '0px',
          paddingBottom: '0px',
          marginTop: '0px',
          marginBottom: '-4px',
          transform: 'translateY(-10px) scale(.8)',
          filter: 'blur(2px)',
        },
      ]
    : [
        {
          opacity: 1,
          width: `${rect.width}px`,
          paddingLeft: '11px',
          paddingRight: '6px',
          marginRight: '0px',
          transform: 'translateY(0) scale(1)',
          filter: 'blur(0)',
        },
        {
          opacity: 1,
          offset: .3,
          transform: 'translateY(2px) scale(.96)',
        },
        {
          opacity: 0,
          width: '0px',
          paddingLeft: '0px',
          paddingRight: '0px',
          marginRight: '-3px',
          transform: 'translateY(-14px) scale(.55) rotate(-2deg)',
          filter: 'blur(2px)',
        },
      ];

  const anim = el.animate(frames, {
    duration: 320,
    easing: 'cubic-bezier(.4, 0, .2, 1)',
    fill: 'forwards',
  });
  anim.onfinish = () => el.remove();
  // На случай отключённых анимаций в системе.
  setTimeout(() => el.remove(), 500);
}

function renderTabs() {
  const data = S.data;
  if (!data) return;
  const container = $('#tabs');
  const seen = new Set();
  const before = new Map();
  for (const [id, el] of S.tabEls) {
    if (el.isConnected) before.set(id, el.getBoundingClientRect());
  }

  // Список вкладок — каждая вкладка отдельным элементом.
  const entries = data.tabs.map((tab) => ({ id: tab.id }));

  // Обновление одной вкладки или одной под-вкладки.
  const updatePart = (partEl, tab, isActive) => {
    if (!partEl || !tab) return;
    partEl.classList.toggle('active', isActive);
    partEl.querySelector('.tab-title').textContent = tab.title || hostOf(tab.url) || 'Новая вкладка';
    partEl.title = tab.error ? tab.error : tab.title || tab.url;
    const slot = partEl.querySelector('.tab-icon-slot');
    if (tab.loading) {
      if (partEl._iconType !== 'spinner') {
        slot.innerHTML = '<span class="tab-spinner"></span>';
        partEl._iconType = 'spinner';
        partEl._favicon = null;
      }
    } else if (tab.service) {
      const svcIcon = (PANEL_META[tab.service] && PANEL_META[tab.service].icon) || 'globe';
      const svcKey = `service:${tab.service}`;
      if (partEl._iconType !== svcKey) {
        slot.innerHTML = `<span class="tab-favicon-fallback">${icon(svcIcon)}</span>`;
        partEl._iconType = svcKey;
        partEl._favicon = null;
      }
    } else if (tab.isSettings) {
      if (partEl._iconType !== 'settings') {
        slot.innerHTML = `<span class="tab-favicon-fallback">${icon('settings')}</span>`;
        partEl._iconType = 'settings';
        partEl._favicon = null;
      }
    } else if (tab.favicon) {
      if (partEl._favicon !== tab.favicon) {
        slot.innerHTML = '<img class="tab-favicon" alt="">';
        const img = slot.firstChild;
        img.addEventListener('error', () => {
          slot.innerHTML = `<span class="tab-favicon-fallback">${icon('globe')}</span>`;
        });
        img.src = tab.favicon;
        partEl._favicon = tab.favicon;
        partEl._iconType = 'favicon';
      }
    } else if (partEl._iconType !== 'fallback') {
      slot.innerHTML = `<span class="tab-favicon-fallback">${icon('globe')}</span>`;
      partEl._iconType = 'fallback';
      partEl._favicon = null;
    }
    partEl.querySelector('.tab-audio').classList.toggle('hidden', !tab.audible);
    partEl.classList.toggle('tab-error', !!tab.error);
    // Тонкая полоска прогресса загрузки внизу вкладки.
    const bar = partEl.querySelector('.tab-progress i');
    const progress = Math.max(0, Math.min(1, Number(tab.progress) || 0));
    partEl.classList.toggle('loading', progress > 0);
    if (bar) bar.style.width = Math.round(progress * 100) + '%';
  };

  for (const entry of entries) {
    seen.add(entry.id);
    let el = S.tabEls.get(entry.id);
    let isNew = false;
    if (!el) {
      el = document.createElement('div');
      el.className = 'tab tab-new';
      el.dataset.id = entry.id;
      el.innerHTML =
        '<span class="tab-icon-slot"></span>' +
        '<span class="tab-title"></span>' +
        `<span class="tab-audio hidden">${icon('volume')}</span>` +
        '<span class="tab-progress"><i></i></span>' +
        `<button class="tab-close" title="Закрыть вкладку">${icon('close')}</button>`;
      S.tabEls.set(entry.id, el);
      container.appendChild(el);
      isNew = true;
    }

    const tab = data.tabs.find((t) => t.id === entry.id);
    el.classList.toggle('active', tab.id === data.activeTabId);
    el.draggable = true;
    updatePart(el, tab, tab.id === data.activeTabId);

    if (isNew) {
      el.addEventListener('animationend', (event) => {
        if (event.animationName === 'tab-open') el.classList.remove('tab-new');
      }, { once: true });
    }
  }

  for (const [id, el] of [...S.tabEls]) {
    if (!seen.has(id)) {
      S.tabEls.delete(id);
      animateTabClose(el);
    }
  }

  // Порядок вкладок. Переставляем только при реальном изменении порядка,
  // иначе браузер заново запускает анимацию появления. Во время перетаскивания
  // порядок задаёт сам пользователь, поэтому не перебиваем его.
  if (!S.dragId) {
    let prev = null;
    for (const entry of entries) {
      const el = S.tabEls.get(entry.id);
      if (!el) continue;
      let next = prev ? prev.nextElementSibling : container.firstElementChild;
      while (next && next.classList.contains('tab-closing')) next = next.nextElementSibling;
      if (next !== el) container.insertBefore(el, next || null);
      prev = el;
    }

    // Плавно раздвигаем/сжимаем оставшиеся вкладки при открытии/закрытии соседней.
    // Анимируем и позицию (translate), и размер (scale): иначе при перераспределении
    // flex-ширины вкладки «скачут» по ширине. Так же делает Chrome/Firefox — ширина
    // меняется плавно, а не мгновенно.
    for (const entry of entries) {
      const el = S.tabEls.get(entry.id);
      const old = before.get(entry.id);
      if (!el || !old || el.classList.contains('tab-new')) continue;
      const now = el.getBoundingClientRect();
      const dx = old.left - now.left;
      const dy = old.top - now.top;
      const sx = now.width > 1 ? old.width / now.width : 1;
      const sy = now.height > 1 ? old.height / now.height : 1;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5 || Math.abs(sx - 1) > 0.02 || Math.abs(sy - 1) > 0.02) {
        el.animate(
          [
            { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, transformOrigin: '0 0' },
            { transform: 'translate(0, 0) scale(1, 1)', transformOrigin: '0 0' },
          ],
          { duration: 210, easing: 'cubic-bezier(.2,.8,.2,1)' },
        );
      }
    }
  }
}

function renderToolbar() {
  const data = S.data;
  if (!data) return;
  const tab = activeTab();
  const back = $('#back');
  const forward = $('#forward');

  back.disabled = !tab || !(data.tabs.find((t) => t.id === data.activeTabId) || {}).canBack;
  forward.disabled = !tab || !(data.tabs.find((t) => t.id === data.activeTabId) || {}).canForward;

  const activeSnapshot = data.tabs.find((t) => t.id === data.activeTabId);
  const loading = activeSnapshot ? activeSnapshot.loading : false;
  const reloadUse = $('#reload-icon use');
  if (reloadUse) reloadUse.setAttribute('href', loading ? '#i-close' : '#i-reload');
  $('#reload').title = loading ? 'Остановить загрузку' : 'Обновить (Ctrl+R)';

  const omnibox = $('#omnibox');
  if (document.activeElement !== omnibox && S.dock !== 'suggest') {
    omnibox.value = tab ? tab.url === 'about:blank' ? '' : tab.url : '';
  }

  const sec = $('#security-icon');
  const secUse = sec.querySelector('use');
  const url = tab ? tab.url : '';
  sec.classList.remove('secure', 'insecure', 'internal');
  if (/^https:/i.test(url)) {
    secUse.setAttribute('href', '#i-lock');
    sec.classList.add('secure');
    sec.title = 'Защищённое соединение (HTTPS)';
  } else if (/^http:/i.test(url)) {
    secUse.setAttribute('href', '#i-alert');
    sec.classList.add('insecure');
    sec.title = 'Незащищённое соединение (HTTP)';
  } else if (/^arch:/i.test(url)) {
    secUse.setAttribute('href', '#i-shield');
    sec.classList.add('internal');
    sec.title = 'Внутренняя страница ArchBrowser';
  } else {
    secUse.setAttribute('href', '#i-globe');
    sec.title = 'Адрес';
  }

  const blocked = activeSnapshot ? activeSnapshot.blocked : 0;
  $('#blocked-chip').classList.toggle('hidden', !(blocked > 0));
  $('#blocked-count').textContent = blocked > 99 ? '99+' : String(blocked);
  $('#blocked-chip').title = `Заблокировано трекеров и рекламы: ${blocked}`;

  const star = $('#star');
  star.classList.toggle('active', !!(tab && tab.bookmarked));
  star.title = tab && tab.bookmarked ? 'Убрать из закладок' : 'Добавить в закладки (Ctrl+D)';
  const starUse = star.querySelector('use');
  starUse.setAttribute('href', tab && tab.bookmarked ? '#i-star-filled' : '#i-star');

  const telegram = $('#telegram-btn');
  const unread = Math.max(0, Number(data.telegramUnread) || 0);
  telegram.classList.toggle('active', !!data.telegramOpen);
  telegram.title = data.telegramOpen ? 'Скрыть Telegram' : 'Открыть Telegram (Ctrl+Shift+M)';
  const telegramBadge = $('#telegram-badge');
  telegramBadge.classList.toggle('hidden', unread <= 0);
  telegramBadge.textContent = unread > 99 ? '99+' : String(unread);
}

function renderVpnChip() {
  if (!S.data) return;
  const vpn = S.data.vpn;
  const chip = $('#vpn-chip');
  chip.classList.toggle('on', !!vpn.connected);
  chip.classList.toggle('busy', !!vpn.connecting);
  let label = 'VPN';
  if (vpn.connecting) label = 'VPN…';
  else if (vpn.connected && vpn.active) {
    const name = vpn.active.name || `${vpn.active.address}:${vpn.active.port}`;
    label = name.length > 16 ? name.slice(0, 15) + '…' : name;
  }
  $('#vpn-chip-label').textContent = label;
  chip.title = vpn.connected
    ? `VPN подключён: ${vpn.active ? vpn.active.name : ''}\nSOCKS5 127.0.0.1:${vpn.socksPort}`
    : vpn.error
      ? `VPN: ${vpn.error}`
      : 'VPN выключен';
}

function renderDownloadBadge() {
  if (!S.data) return;
  const active = (S.data.downloads || []).some((d) => d.state === 'progressing');
  $('#download-badge').classList.toggle('hidden', !active);
}

// Индикаторы таймера и будильника стоят перед кнопкой VPN.
function renderTimerChips() {
  if (!S.data) return;
  const timer = S.data.timer || {};
  const timerChip = $('#timer-chip');
  const timerLabel = $('#timer-chip-label');
  if (timerChip && timerLabel) {
    const running = !!timer.running;
    timerChip.classList.toggle('hidden', !running);
    timerLabel.textContent = timer.label || '00:00';
    timerChip.title = running ? `Таймер: осталось ${timer.label || ''}` : 'Таймер';
  }
  const alarmChip = $('#alarm-chip');
  const alarmLabel = $('#alarm-chip-label');
  if (alarmChip && alarmLabel) {
    const alarm = timer.alarm || '';
    alarmChip.classList.toggle('hidden', !alarm);
    alarmLabel.textContent = alarm;
    alarmChip.title = alarm ? `Ближайший будильник: ${alarm}` : 'Будильник';
  }
}

/* ------------------------------------------------------------------ dock */
// Выпадающий список подсказок выравнивается по адресной строке: та же ширина
// и строго под ней, без отдельной широкой панели.
function syncDockGeometry() {
  const dock = $('#dock');
  const wrap = $('#omnibox-wrap');
  const chrome = $('#chrome');
  if (!dock || !wrap || !chrome) return;
  const wrapRect = wrap.getBoundingClientRect();
  const chromeRect = chrome.getBoundingClientRect();
  if (!wrapRect.width || !chromeRect.width) return;
  dock.style.setProperty('--dock-left', `${Math.round(wrapRect.left - chromeRect.left)}px`);
  dock.style.setProperty('--dock-width', `${Math.round(wrapRect.width)}px`);
}

function openDock(type, html, { focusSel } = {}) {
  S.dock = type;
  const dock = $('#dock');
  dock.classList.remove('hidden');
  dock.innerHTML = html;
  syncDockGeometry();
  if (focusSel) {
    const target = $(focusSel, dock);
    if (target) {
      target.focus();
      if (target.select) target.select();
    }
  }
}

function closeDock() {
  if (!S.dock) return;
  S.dock = null;
  const dock = $('#dock');
  dock.classList.add('hidden');
  dock.innerHTML = '';
}

function dockHeightSync() {
  const height = $('#chrome').getBoundingClientRect().height;
  invoke('ui:chrome-height', { height }).catch(() => {});
}

/* ------------------------------------------------------------------ menu */
function menuTemplate() {
  const s = (S.data && S.data.settings) || {};
  const rows = [
    ['new-tab', 'Новая вкладка', 'Ctrl+T', 'plus'],
    ['new-private', 'Новое приватное окно', 'Ctrl+Shift+N', 'eye-off'],
    ['sep'],
    ['history', 'История', 'Ctrl+H', 'history'],
    ['bookmarks', 'Закладки', 'Ctrl+Shift+O', 'bookmark'],
    ['downloads', 'Загрузки', 'Ctrl+J', 'download'],
    ...(s.featureLocalPlayer === false ? [] : [['player', 'Плеер', '', 'music']]),
    ...(s.featureBittorrent === false ? [] : [['torrent', 'Загрузки torrent', '', 'torrent']]),
    ['extensions', 'Расширения', '', 'puzzle'],
    ['vpn', 'VPN', '', 'shield'],
    ['telegram', 'Telegram', 'Ctrl+Shift+M', 'telegram'],
    ['sep'],
    ['share', 'Поделиться страницей…', '', 'share'],
    ['timer', 'Таймер и будильник…', '', 'timer'],
    ['fullscreen', 'Полный экран', 'F11', 'fullscreen'],
    ['compact', s.compactToolbar ? 'Показать кнопки справа' : 'Скрыть кнопки справа', '', s.compactToolbar ? 'chevron-left' : 'chevron-right'],
    ['bookmarks-bar', s.showBookmarksBar ? 'Скрыть панель закладок' : 'Показать панель закладок', '', 'bookmark'],
    ['reader', 'Режим чтения', 'Alt+R', 'reader'],
    ['sep'],
    ['settings', 'Настройки', 'Ctrl+,', 'settings'],
    ['bookmark-page', 'Добавить страницу в закладки', 'Ctrl+D', 'star'],
    ['clear-data', 'Очистить данные', 'Ctrl+Shift+Del', 'trash'],
    ['about', 'О программе', '', 'info'],
    ['sep'],
    ['quit', 'Выйти', 'Alt+F4', 'close'],
  ];

  let html = '<div class="menu-popover">';
  for (const [action, label, shortcut, iconName] of rows) {
    if (action === 'sep') {
      html += '<div class="menu-sep"></div>';
      continue;
    }
    html += `<div class="menu-row ${action === 'quit' ? 'danger' : ''}" data-action="${action}">
      ${icon(iconName)}<span class="menu-label">${label}</span>
      ${shortcut ? `<span class="menu-shortcut">${shortcut}</span>` : ''}
    </div>`;
  }
  html += '</div>';
  return html;
}

async function menuAction(action) {
  closeDock();
  try {
    switch (action) {
      case 'new-tab':
        await invoke('tabs:create', {});
        break;
      case 'new-private':
        await invoke('window:new-private');
        break;
      case 'history':
        setPanel('history');
        break;
      case 'bookmarks':
        setPanel('bookmarks');
        break;
      case 'downloads':
        setPanel('downloads');
        break;
      case 'player':
        setPanel('player');
        break;
      case 'torrent':
        setPanel('torrent');
        break;
      case 'extensions':
        setPanel('extensions');
        break;
      case 'vpn':
        setPanel('vpn');
        break;
      case 'telegram':
        await invoke('telegram:toggle', {});
        break;
      case 'share':
        await invoke('tabs:share-menu');
        break;
      case 'timer':
        await invoke('tabs:create', { url: 'arch://newtab' });
        break;
      case 'fullscreen':
        await invoke('window:fullscreen');
        break;
      case 'compact':
        await applySetting('compactToolbar', !(S.data && S.data.settings && S.data.settings.compactToolbar));
        await refreshState();
        break;
      case 'bookmarks-bar':
        await applySetting('showBookmarksBar', !(S.data && S.data.settings && S.data.settings.showBookmarksBar));
        await refreshState();
        break;
      case 'reader':
        await toggleReaderMode();
        break;
      case 'settings':
        await invoke('settings:open-tab');
        break;
      case 'about':
        setPanel('about');
        break;
      case 'bookmark-page':
        await toggleBookmark();
        break;
      case 'clear-data':
        await clearData(true);
        break;
      case 'quit':
        await invoke('app:quit');
        break;
    }
  } catch (err) {
    toast(cleanError(err), 'error');
  }
}

/* ------------------------------------------------------------------ panel */
// Панель — слой интерфейса, а страница — нативный view поверх него. Панель
// рисуется только после того, как главный процесс подтвердил режим и убрал
// страницу из-под панели, иначе раздел просто не был бы виден.
function setPanel(mode) {
  closeDock();
  clearTimeout(S.panelConfirmTimer);
  if (mode === 'web') {
    S.mode = 'web';
    S.pendingMode = null;
    hidePanel();
    invoke('ui:mode', { mode: 'web' }).catch(() => {});
    setTimeout(() => invoke('tabs:focus-page').catch(() => {}), 60);
    return;
  }
  S.pendingMode = mode;
  S.panelRequestedAt = Date.now();
  invoke('ui:mode', { mode }).catch((err) => {
    if (S.pendingMode !== mode) return;
    S.pendingMode = null;
    toast(`Не удалось открыть раздел: ${cleanError(err)}`, 'error');
  });
  // Если главный процесс не подтвердил режим — сообщаем, вместо того чтобы
  // молча ничего не показывать.
  S.panelConfirmTimer = setTimeout(() => {
    if (S.pendingMode !== mode) return;
    S.pendingMode = null;
    toast('Раздел не открылся: браузер не переключил режим', 'error');
  }, 2000);
}

function hidePanel() {
  $('#panel').classList.add('hidden');
  $('#panel-body').innerHTML = '';
  clearInterval(TORRENT.timer);
  TORRENT.timer = null;
  closeTorrentModal();
}

function renderPanel(mode) {
  const meta = PANEL_META[mode];
  if (!meta) return;
  $('#panel').classList.remove('hidden');
  $('#panel-title').textContent = meta.title;
  $('#panel-icon').innerHTML = icon(meta.icon);
  const body = $('#panel-body');
  body.classList.toggle('player-wide', mode === 'player');
  body.classList.toggle('torrent-wide', mode === 'torrent');
  if (mode !== 'torrent') {
    clearInterval(TORRENT.timer);
    TORRENT.timer = null;
    closeTorrentModal();
  }
  const token = ++S.panelToken;

  // Ошибка отрисовки не должна оставлять пустую панель: показываем, что
  // именно сломалось.
  try {
    if (mode === 'settings') renderSettings(body);
    else if (mode === 'vpn') renderVpn(body, token);
    else if (mode === 'extensions') renderExtensions(body);
    else if (mode === 'history') renderHistory(body, token);
    else if (mode === 'bookmarks') renderBookmarks(body, token);
    else if (mode === 'downloads') renderDownloads(body);
    else if (mode === 'player') renderPlayer(body, token);
    else if (mode === 'torrent') renderTorrent(body, token);
    else if (mode === 'about') renderAbout(body);
  } catch (err) {
    console.error('[panel] не удалось открыть «' + meta.title + '»:', err);
    body.innerHTML = `<div class="empty">Не удалось открыть раздел «${esc(meta.title)}»:<br>${esc(cleanError(err))}</div>`;
  }
}

async function toggleBookmark() {
  const tab = activeTab();
  if (!tab || !/^https?:/i.test(tab.url)) {
    toast('Эту страницу нельзя добавить в закладки');
    return;
  }
  const list = await invoke('bookmarks:list');
  const norm = (u) => {
    try {
      const x = new URL(u);
      x.hash = '';
      return x.toString();
    } catch {
      return u;
    }
  };
  const existing = (list || []).find((b) => norm(b.url) === norm(tab.url));
  if (existing) {
    await invoke('bookmarks:remove', { id: existing.id });
    toast('Удалено из закладок');
  } else {
    await invoke('bookmarks:add', { url: tab.url, title: tab.title });
    toast('Добавлено в закладки');
  }
  await refreshState();
}

async function refreshState() {
  try {
    const data = await invoke('state:get');
    if (data) onState(data);
  } catch {}
}

function renderEmpty(iconName, title, sub) {
  return `<div class="empty">${icon(iconName)}<div class="empty-title">${esc(title)}</div><div class="empty-sub">${esc(sub || '')}</div></div>`;
}

/* ------------------------------------------------------------------ settings */
function settingSwitch(key, title, desc, note) {
  const on = !!(S.data.settings[key]);
  return `<div class="setting">
    <div class="setting-text"><div class="setting-title">${title}</div><div class="setting-desc">${desc}${note ? ` <span style="color:#f0b429">${note}</span>` : ''}</div></div>
    <div class="setting-control"><label class="switch"><input type="checkbox" data-setting="${key}" ${on ? 'checked' : ''}><span class="slider"></span></label></div>
  </div>`;
}

function settingSelect(key, title, desc, options) {
  const value = S.data.settings[key];
  return `<div class="setting">
    <div class="setting-text"><div class="setting-title">${title}</div><div class="setting-desc">${desc}</div></div>
    <div class="setting-control"><select class="select" data-setting="${key}">
      ${options.map(([val, label]) => `<option value="${esc(val)}" ${val === value ? 'selected' : ''}>${esc(label)}</option>`).join('')}
    </select></div>
  </div>`;
}

function settingText(key, title, desc, placeholder) {
  const value = S.data.settings[key] || '';
  return `<div class="setting">
    <div class="setting-text"><div class="setting-title">${title}</div><div class="setting-desc">${desc}</div></div>
    <div class="setting-control"><input class="text-input" type="text" data-setting="${key}" value="${esc(value)}" placeholder="${esc(placeholder || '')}"></div>
  </div>`;
}

function renderSettings(body) {
  const s = S.data.settings;
  const stats = S.data.privacyStats || { total: 0, blocklistSize: 0 };
  const version = S.data.version;

  body.innerHTML = `
    <div class="info-box">${icon('shield')}<div>
      Сетевой щит активен: блок-лист из <b>${Number(stats.blocklistSize || 0).toLocaleString('ru-RU')}</b> доменов,
      сторонние cookies вырезаются, трекеры не получают ваш визит. Заблокировано за сессию: <b>${Number(stats.total || 0).toLocaleString('ru-RU')}</b>.
    </div></div>

    <div class="section-label">Защита от слежки</div>
    <div class="card">
      ${settingSwitch('blockAds', 'Блокировать рекламу', 'Сетевые запросы к рекламным серверам обрываются до загрузки.')}
      ${settingSwitch('blockTrackers', 'Блокировать трекеры', 'Аналитика, пиксели и системы отслеживания не получают данных.')}
      ${settingSwitch('blockThirdPartyCookies', 'Блокировать сторонние cookies', 'Сайты не могут узнавать вас через cookies, оставленные другими сайтами.')}
      ${settingSwitch('httpsOnly', 'Только HTTPS', 'HTTP-адреса автоматически переводятся на защищённое соединение HTTPS.')}
      ${settingSwitch('stripTrackingParams', 'Удалять трекинговые параметры', 'Из адресов вырезаются utm_*, fbclid, gclid и другие метки.')}
      ${settingSwitch('trimReferrer', 'Обрезать Referer', 'При переходах между сайтами передаётся только домен, без полного адреса.')}
      ${settingSwitch('fingerprintProtection', 'Защита от фингерпринтинга', 'Шум для canvas, WebGL и аудио, скрытие автоматизации.', '(нужен перезапуск)')}
      ${settingSwitch('webrtcLeakProtection', 'Защита от утечек WebRTC', 'WebRTC не раскрывает ваш реальный IP-адрес в обход VPN.')}
      ${settingSwitch('sendDnt', 'Do Not Track / GPC', 'Отправлять сигналы DNT и Global Privacy Control.')}
    </div>

    <div class="section-label">DNS и сеть</div>
    <div class="card">
      ${settingSwitch('doh', 'DNS-over-HTTPS', 'Шифрует DNS-запросы, чтобы провайдер не видел, какие сайты вы открываете.', '(нужен перезапуск)')}
      ${settingSelect('dohServer', 'DNS-сервер', 'Используется для шифрованных DNS-запросов.', DOH_SERVERS)}
      ${settingSwitch('vpnBypassRu', 'Домены .ru и .рф — напрямую', 'Эти сайты открываются без прокси. Если какой-то из них напрямую не отвечает, браузер сам повторит загрузку через VPN.')}
      ${settingSwitch('clearOnExit', 'Очищать данные при выходе', 'Удалять cookies, кеш и локальное хранилище после закрытия браузера.')}
    </div>

    <div class="section-label">Оформление</div>
    <div class="card">
      ${settingSelect('appearance', 'Режим оформления', 'Светлый или тёмный вид. «Как в системе» следует за Windows. У каждой темы есть оба варианта.', APPEARANCE_LIST)}
      ${settingSelect('theme', 'Тема', '«Оригинальная» — нейтральный фон с акцентными элементами системы, «Акцентная» — та же тема с тонированными поверхностями.', THEMES_LIST)}
      ${settingSwitch('holidayThemeAuto', 'Автотема праздников', 'За 7 дней до праздника включать его тему и вернуть прежнюю через 7 дней после. Праздничные темы: Новый год, Рождество, 14 и 23 февраля, 8 марта, 1 и 9 мая, 12 июня, 4 ноября и Хэллоуин.')}
      ${settingSelect('mediaBarPosition', 'Пульт медиа', 'Где показывать панель управления музыкой, когда она играет.', [
        ['top', 'Сверху, под адресной строкой'],
        ['bottom', 'Снизу окна'],
      ])}
      <div class="setting">
        <div class="setting-text">
          <div class="setting-title">${icon('info')} Как выбрать тему</div>
          <div class="setting-desc">Тема задаёт характер оформления, а режим — светлый или тёмный вариант. Праздничные темы добавляют на новую вкладку тематический символ и обратный отсчёт до праздника.</div>
        </div>
      </div>
    </div>

    <div class="section-label">RSS-ленты</div>
    <div class="card">
      ${settingSwitch('rssEnabled', 'Читать RSS-ленты', 'Заголовки из подписок показываются внизу новой вкладки.')}
      ${settingSelect('rssIntervalMinutes', 'Обновление лент', 'Как часто браузер забирает новые записи.', [
        ['15', 'Каждые 15 минут'],
        ['30', 'Каждые 30 минут'],
        ['60', 'Каждый час'],
        ['180', 'Каждые 3 часа'],
      ])}
      <div class="setting">
        <div class="setting-text">
          <div class="setting-title">${icon('import')} Добавить ленту</div>
          <div class="setting-desc">Укажите адрес RSS или Atom. Подписку можно переименовать и удалить.</div>
        </div>
        <div class="setting-control">
          <button class="btn primary" data-action="rss-add">${icon('import')} Добавить</button>
          <button class="btn" data-action="rss-refresh">${icon('reload')} Обновить</button>
        </div>
      </div>
      <div id="rss-list" class="rss-list-settings"></div>
    </div>

    <div class="section-label">Дополнительные функции</div>
    <div class="card">
      ${settingSwitch('featureLoadingSkeleton', 'Прототип при загрузке', 'Вместо белого экрана показывать макет страницы с эффектом боке.')}
      ${settingSwitch('featureReaderMode', 'Режим чтения', 'Кнопка в адресной строке и Alt+R оставляют только текст статьи.')}
      ${settingSwitch('featureTimerPresets', 'Пресеты таймера', 'Показывать на новой вкладке готовые пресеты 10, 45 и 60 минут.')}
      ${settingSwitch('featureLocalPlayer', 'Локальный плеер', 'Встроенный проигрыватель аудиофайлов с компьютера.')}
      ${settingSwitch('featureMediaController', 'Пульт медиа', 'Панель управления воспроизведением в панели инструментов.')}
      ${settingSwitch('trackNotify', 'Уведомление о композиции', 'Показывать системное уведомление при начале новой композиции.')}
      ${settingSwitch('featureBittorrent', 'BitTorrent-клиент', 'Скачивание .torrent и magnet-ссылок.')}
      ${settingSwitch('featureNotifications', 'Всплывающие сообщения', 'Разрешить сайтам показывать уведомления (список сайтов — ниже).')}
    </div>

    <div class="section-label">Уведомления с сайтов</div>
    <div class="card">
      ${settingSelect('notificationsMode', 'Кому разрешать', 'Что может выводить всплывающие сообщения.', [
        ['off', 'Никому'],
        ['allow', 'Всем сайтам'],
        ['sites', 'Только сайтам из списка'],
      ])}
      <div class="setting">
        <div class="setting-text">
          <div class="setting-title">${icon('plus')} Разрешённые сайты</div>
          <div class="setting-desc">Домен или маска вида <code>*.example.com</code>. Список нужен, только если выбран режим «Только сайтам из списка».</div>
        </div>
        <div class="setting-control">
          <button class="btn" data-action="notify-site-add">${icon('plus')} Добавить</button>
        </div>
      </div>
      <div id="notify-sites" class="notify-sites"></div>
    </div>

    <div class="section-label">Браузер</div>
    <div class="card">
      ${settingSelect('searchEngine', 'Поисковая система', 'Используется, когда в адресной строке введён запрос.', ENGINES)}
      ${settingSelect('tabPosition', 'Положение вкладок', 'Панель вкладок сверху, снизу или вертикально сбоку.', [
        ['top', 'Сверху'],
        ['bottom', 'Снизу'],
        ['left', 'Слева (вертикально)'],
        ['right', 'Справа (вертикально)'],
      ])}
      ${settingText('homepage', 'Домашняя страница', 'Открывается при запуске и по кнопке «Домой».', 'arch://newtab')}
      ${settingSwitch('showBookmarksBar', 'Панель закладок', 'Показывать закладки и папки под адресной строкой.')}
      ${settingSwitch('compactToolbar', 'Компактная панель', 'Скрыть кнопки справа от адресной строки — останется одна кнопка «Показать».')}
    </div>

    <div class="section-label">Загрузки</div>
    <div class="card">
      <div class="setting">
        <div class="setting-text">
          <div class="setting-title">${icon('folder')} Папка загрузок</div>
          <div class="setting-desc" id="download-dir-value">${esc(s.downloadDir || 'Системная папка «Загрузки»')}</div>
        </div>
        <div class="setting-control" style="display:flex;gap:6px">
          <button class="btn" data-action="download-dir">${icon('folder')} Изменить</button>
          <button class="btn" data-action="download-open-dir">${icon('external')} Открыть</button>
        </div>
      </div>
      ${settingSelect('downloadMode', 'Куда сохранять', 'Можно сохранять сразу в папку загрузок или каждый раз спрашивать путь.', [
        ['auto', 'Сохранять в «Загрузки»'],
        ['ask', 'Спрашивать каждый раз'],
      ])}
      ${settingSwitch('downloadNotify', 'Уведомления о загрузках', 'Системные уведомления о начале, завершении и ошибках скачивания.')}
      ${settingSwitch('downloadOpenPrompt', 'Предлагать открыть файл', 'После завершения — открыть файл, показать в папке или закрыть.')}
      <div class="setting">
        <div class="setting-text">
          <div class="setting-title">${icon('download')} Список загрузок</div>
          <div class="setting-desc">Прогресс, скорость и действия с файлами — в панели «Загрузки» (Ctrl+J).</div>
        </div>
        <div class="setting-control">
          <button class="btn" data-action="downloads-panel">${icon('download')} Открыть</button>
        </div>
      </div>
    </div>

    <div class="section-label">Импорт из браузера</div>
    <div class="card">
      <div class="setting">
        <div class="setting-text">
          <div class="setting-title">${icon('import')} Импорт данных</div>
          <div class="setting-desc">Перенесите закладки, пароли, историю и открытые вкладки из Chrome, Edge, Brave, Vivaldi, Opera или Firefox. Пароли хранятся зашифрованными средствами Windows (DPAPI).</div>
        </div>
        <div class="setting-control"><button class="btn primary" data-action="import-open">${icon('import')} Импорт из браузера…</button></div>
      </div>
      <div id="import-modal" class="import-modal hidden"></div>
    </div>

    <div class="section-label">Пароли</div>
    <div class="card" id="password-card">
      <div class="setting">
        <div class="setting-text">
          <div class="setting-title">${icon('key')} Менеджер паролей</div>
          <div class="setting-desc" id="password-summary">Загрузка…</div>
        </div>
        <div class="setting-control"><button class="btn" data-action="password-refresh">${icon('reload')} Обновить</button></div>
      </div>
      <div class="setting">
        <div class="setting-text">
          <div class="setting-title">${icon('lock')} Мастер-пароль</div>
          <div class="setting-desc" id="password-master-desc">Хранилище зашифровано средствами Windows (DPAPI). Мастер-пароль добавит собственное шифрование AES-256-GCM с ключом от scrypt — без него файл паролей не открыть.</div>
        </div>
        <div class="setting-control">
          <button class="btn" data-action="password-master">${icon('key')} Задать мастер-пароль</button>
          <button class="btn" data-action="password-lock" title="Заблокировать хранилище">${icon('lock')}</button>
        </div>
      </div>
      <div class="setting">
        <div class="setting-text">
          <div class="setting-title">Автоблокировка</div>
          <div class="setting-desc">Через сколько минут бездействия хранилище паролей блокируется.</div>
        </div>
        <div class="setting-control">
          <select class="select" data-setting="passwordAutoLockMinutes">
            ${[0, 5, 15, 30, 60].map((m) => `<option value="${m}"${Number(s.passwordAutoLockMinutes) === m ? ' selected' : ''}>${m ? `${m} мин` : 'Не блокировать'}</option>`).join('')}
          </select>
        </div>
      </div>
      <div id="password-list" class="password-list"></div>
    </div>

    <div class="section-label">Telegram Desktop Помощник</div>
    <div class="card">
      <div class="setting">
        <div class="setting-text">
          <div class="setting-title">${icon('telegram')} Проверенные MTProto-прокси</div>
          <div class="setting-desc">Загружает <code>proxy_all_verified.json</code> из последнего релиза Telegram Proxy Collector и передаёт новые прокси в Telegram Desktop. Уже отправленные ссылки повторно не открываются.</div>
        </div>
        <div class="setting-control">
          <button class="btn" data-action="telegram-proxies">${icon('download')} Импортировать</button>
        </div>
      </div>
      <div class="setting">
        <div class="setting-text">
          <div class="setting-title">Все ссылки tg://proxy</div>
          <div class="setting-desc">Скопировать свежий список в буфер обмена — удобно для ручного добавления.</div>
        </div>
        <div class="setting-control"><button class="btn" data-action="telegram-copy">${icon('external')} Скопировать</button></div>
      </div>
    </div>

    <div class="section-label">Данные</div>
    <div class="card">
      <div class="setting">
        <div class="setting-text"><div class="setting-title">Очистить cookies, кеш и историю</div><div class="setting-desc">Локальные данные браузера будут удалены. Закладки и настройки останутся.</div></div>
        <div class="setting-control"><button class="btn danger" data-action="clear">${icon('trash')} Очистить</button></div>
      </div>
      <div class="setting">
        <div class="setting-text"><div class="setting-title">Перезапустить браузер</div><div class="setting-desc">Требуется после включения DoH или защиты от фингерпринтинга.</div></div>
        <div class="setting-control"><button class="btn" data-action="restart">${icon('reload')} Перезапустить</button></div>
      </div>
    </div>

    <div class="section-label">Система</div>
    <div class="card">
      <div class="kv"><span>ArchBrowser</span><span>${esc(version.app)}</span></div>
      <div class="kv"><span>Chromium</span><span>${esc(version.chrome)}</span></div>
      <div class="kv"><span>Electron</span><span>${esc(version.electron)}</span></div>
      <div class="kv"><span>Блок-лист</span><span>${Number(stats.blocklistSize || 0).toLocaleString('ru-RU')} доменов</span></div>
      <div class="kv"><span>Xray core</span><span>${S.data.vpn.coreAvailable ? 'доступен' : 'не найден'}</span></div>
    </div>
  `;

  $$('input[type="checkbox"][data-setting]', body).forEach((input) => {
    input.addEventListener('change', async () => {
      await applySetting(input.dataset.setting, input.checked);
    });
  });
  $$('select[data-setting]', body).forEach((select) => {
    select.addEventListener('change', async () => {
      await applySetting(select.dataset.setting, select.value);
    });
  });
  $$('input[type="text"][data-setting]', body).forEach((input) => {
    input.addEventListener('change', async () => {
      await applySetting(input.dataset.setting, input.value.trim());
    });
  });

  $('[data-action="clear"]', body).addEventListener('click', () => clearData(true));
  $('[data-action="download-dir"]', body)?.addEventListener('click', async () => {
    try {
      const res = await invoke('downloads:pick-dir');
      if (!res || res.canceled) return;
      await applySetting('downloadDir', res.directory);
      toast(`Папка загрузок: ${res.directory}`);
    } catch (err) {
      toast(cleanError(err), 'error');
    }
  });
  $('[data-action="download-open-dir"]', body)?.addEventListener('click', () => {
    invoke('downloads:open-dir').catch((err) => toast(cleanError(err), 'error'));
  });
  $('[data-action="downloads-panel"]', body)?.addEventListener('click', () => setPanel('downloads'));
  $('[data-action="restart"]', body).addEventListener('click', async () => {
    await invoke('settings:restart');
  });
  $('[data-action="import-scan"]', body)?.addEventListener('click', () => scanBrowsers(body));
  $('[data-action="password-refresh"]', body)?.addEventListener('click', () => loadPasswords(body));
  $('[data-action="telegram-proxies"]', body)?.addEventListener('click', () => importTelegramProxies());
  $('[data-action="telegram-copy"]', body)?.addEventListener('click', () => copyTelegramProxies());
  $('[data-action="import-open"]', body)?.addEventListener('click', () => openImportModal());
  $('[data-action="password-master"]', body)?.addEventListener('click', async () => {
    await setupMasterPassword(body);
  });
  $('[data-action="password-lock"]', body)?.addEventListener('click', async () => {
    await invoke('passwords:lock');
    toast('Хранилище паролей заблокировано');
    await refreshState();
  });
  $('[data-action="rss-add"]', body)?.addEventListener('click', async () => {
    const url = await promptDialog('Добавить RSS-ленту', {
      hint: 'Введите адрес RSS или Atom-ленты.',
      placeholder: 'https://example.com/feed.xml',
    });
    if (!url) return;
    try {
      await invoke('rss:add', { url });
      toast('Лента добавлена');
      await refreshState();
      renderRssFeeds(body);
    } catch (err) {
      toast(cleanError(err), 'error');
    }
  });
  $('[data-action="rss-refresh"]', body)?.addEventListener('click', async () => {    const btn = $('[data-action="rss-refresh"]', body);
    if (btn) btn.disabled = true;
    try {
      const res = await invoke('rss:refresh');
      toast(`Обновлено, заголовков: ${res.count || 0}`);
      await refreshState();
    } catch (err) {
      toast(cleanError(err), 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });
  $('[data-action="notify-site-add"]', body)?.addEventListener('click', async () => {
    const host = await promptDialog('Разрешить сайт', {
      hint: 'Введите домен сайта, который сможет показывать уведомления.',
      placeholder: 'example.com',
    });
    if (!host) return;
    const list = Array.isArray(s.settings.notificationSites) ? [...s.settings.notificationSites] : [];
    if (!list.includes(host)) list.push(host);
    await applySetting('notificationSites', list);
    await refreshState();
    renderNotifySites(body);
  });
  renderNotifySites(body);
  renderRssFeeds(body);
  loadPasswords(body);
}

// Список сайтов, которым разрешены уведомления.
function renderNotifySites(body) {
  const list = $('#notify-sites', body);
  if (!list) return;
  const sites = (S.data && S.data.settings && S.data.settings.notificationSites) || [];
  if (!sites.length) {
    list.innerHTML = '<div class="setting-desc" style="padding:4px 2px">Список пуст.</div>';
    return;
  }
  list.innerHTML = sites.map((host) => `
    <div class="setting">
      <div class="setting-text"><div class="setting-title">${esc(host)}</div></div>
      <div class="setting-control">
        <button class="icon-btn danger" data-notify-remove="${esc(host)}" title="Убрать">${icon('trash')}</button>
      </div>
    </div>`).join('');
  $$('[data-notify-remove]', list).forEach((btn) => {
    btn.addEventListener('click', async () => {
      const current = (S.data && S.data.settings && S.data.settings.notificationSites) || [];
      await applySetting('notificationSites', current.filter((h) => h !== btn.dataset.notifyRemove));
      await refreshState();
      renderNotifySites(body);
    });
  });
}

// Список подписок RSS в настройках.
async function renderRssFeeds(body) {
  const list = $('#rss-list', body);
  if (!list) return;
  let data = { feeds: [] };
  try {
    data = await invoke('rss:list');
  } catch {
    return;
  }
  const feeds = data.feeds || [];
  if (!feeds.length) {
    list.innerHTML = '<div class="setting-desc" style="padding:4px 2px">Подписок пока нет.</div>';
    return;
  }
  list.innerHTML = feeds.map((feed) => `
    <div class="setting">
      <div class="setting-text">
        <div class="setting-title">${esc(feed.title || feed.url)}</div>
        <div class="setting-desc">${esc(feed.url)}${feed.error ? ` · ошибка: ${esc(feed.error)}` : ''}</div>
      </div>
      <div class="setting-control">
        <button class="icon-btn" data-rss-rename="${esc(feed.id)}" title="Переименовать">${icon('settings')}</button>
        <button class="icon-btn danger" data-rss-remove="${esc(feed.id)}" title="Удалить">${icon('trash')}</button>
      </div>
    </div>`).join('');
  $$('[data-rss-remove]', list).forEach((btn) => {
    btn.addEventListener('click', async () => {
      await invoke('rss:remove', { id: btn.dataset.rssRemove });
      toast('Подписка удалена');
      await refreshState();
      renderRssFeeds(body);
    });
  });
  $$('[data-rss-rename]', list).forEach((btn) => {
    btn.addEventListener('click', async () => {
      const feed = feeds.find((f) => f.id === btn.dataset.rssRename);
      if (!feed) return;
      const title = await promptDialog('Переименовать подписку', { value: feed.title || feed.url });
      if (!title) return;
      await invoke('rss:rename', { id: feed.id, title });
      await refreshState();
      renderRssFeeds(body);
    });
  });
}

/* ------------------------------------------------------------------ мастер-пароль */
function masterDialog(body, { title, hint, withCurrent }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'import-modal-overlay';
    overlay.innerHTML = `
      <div class="import-modal-card">
        <div class="import-modal-head">
          <div class="import-modal-title">${esc(title)}</div>
          <button class="icon-btn" data-master-close title="Закрыть">${icon('close')}</button>
        </div>
        <div class="import-modal-body">
          <div class="import-desc">${esc(hint)}</div>
          ${withCurrent ? '<div class="modal-field"><label>Текущий мастер-пароль</label><input type="password" id="master-current" autocomplete="current-password"></div>' : ''}
          <div class="modal-field"><label>Мастер-пароль</label><input type="password" id="master-new" autocomplete="new-password"></div>
          <div class="modal-field"><label>Повторите мастер-пароль</label><input type="password" id="master-repeat" autocomplete="new-password"></div>
          <div class="import-modal-actions">
            <button class="btn" data-master-close>Отмена</button>
            <button class="btn primary" data-master-save>Сохранить</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    holdPageHidden(true);
    const close = (value) => {
      if (!overlay.isConnected) return;
      overlay.remove();
      holdPageHidden(false);
      resolve(value);
    };
    const current = overlay.querySelector('#master-current');
    const next = overlay.querySelector('#master-new');
    const repeat = overlay.querySelector('#master-repeat');
    overlay.querySelectorAll('[data-master-close]').forEach((b) => b.addEventListener('click', () => close(null)));
    overlay.querySelector('[data-master-save]').addEventListener('click', () => {
      if (!next.value || next.value.length < 6) {
        toast('Мастер-пароль должен быть не короче 6 символов', 'error');
        return;
      }
      if (next.value !== repeat.value) {
        toast('Пароли не совпадают', 'error');
        return;
      }
      close({ master: next.value, current: current ? current.value : '' });
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });
    (current || next).focus();
  });
}

async function setupMasterPassword(body) {
  const hasMaster = !!(S.data && S.data.passwords && S.data.passwords.hasMaster);
  const result = await masterDialog(body, {
    title: hasMaster ? 'Изменить мастер-пароль' : 'Задать мастер-пароль',
    hint: 'Мастер-пароль шифрует хранилище паролей. Запомните его: без него пароли восстановить нельзя.',
    withCurrent: hasMaster,
  });
  if (!result) return;
  try {
    await invoke('passwords:master', { master: result.master, current: result.current });
    toast('Мастер-пароль установлен');
    await refreshState();
  } catch (err) {
    toast(cleanError(err), 'error');
  }
}

/* ------------------------------------------------------------------ import */
let lastImportSummary = '';

async function openImportModal() {
  const modalEl = $('#import-modal');
  if (!modalEl) return;
  modalEl.classList.remove('hidden');
  modalEl.innerHTML = `
    <div class="import-modal-overlay">
      <div class="import-modal-card">
        <div class="import-modal-head">
          <div class="import-modal-title">${icon('import')} Импорт из браузера</div>
          <button class="icon-btn" data-import-close title="Закрыть">${icon('close')}</button>
        </div>
        <div class="import-modal-body">
          <div class="import-step" id="import-step-scan">
            <div class="import-desc">Выберите, что импортировать, и нажмите «Найти браузеры».</div>
            <div class="import-options">
              <label class="import-opt"><input type="checkbox" data-import-type="bookmarks" checked> Закладки</label>
              <label class="import-opt"><input type="checkbox" data-import-type="passwords" checked> Пароли</label>
              <label class="import-opt"><input type="checkbox" data-import-type="history" checked> История</label>
              <label class="import-opt"><input type="checkbox" data-import-type="tabs"> Открытые вкладки</label>
            </div>
            <div class="import-modal-actions">
              <button class="btn primary" data-import-scan>${icon('search')} Найти браузеры</button>
              <button class="btn" data-import-csv>${icon('import')} Пароли из CSV…</button>
            </div>
            <div class="import-note">
              Chrome 127+ шифрует пароли «app-bound» — их нельзя прочитать из файла
              профиля. Экспортируйте пароли в Chrome
              (<code>chrome://password-manager/settings</code> → «Экспорт паролей») и
              импортируйте CSV этой кнопкой.
            </div>
          </div>
          <div class="import-step hidden" id="import-step-list">
            <div class="import-desc">Выберите профили для импорта:</div>
            <div id="import-profiles" class="import-profiles"></div>
            <div class="import-modal-actions">
              <button class="btn" data-import-back>${icon('back')} Назад</button>
              <button class="btn primary" data-import-run>${icon('import')} Импортировать выбранное</button>
            </div>
          </div>
          <div class="import-step hidden" id="import-step-progress">
            <div class="import-desc" id="import-progress-text">Подготовка…</div>
            <div class="import-progress-bar"><div id="import-progress-fill"></div></div>
          </div>
          <div class="import-step hidden" id="import-step-done">
            <div class="import-success">${icon('check')}</div>
            <div class="import-desc" id="import-result-text"></div>
            <div class="import-warnings hidden" id="import-warnings"></div>
            <button class="btn primary" data-import-close-done>Готово</button>
          </div>
        </div>
      </div>
    </div>
  `;
  bindImportModalEvents();
  await scanBrowsersForModal();
}

async function scanBrowsersForModal() {
  const scanBtn = $('[data-import-scan]');
  const progressText = $('#import-progress-text');
  const profilesEl = $('#import-profiles');
  if (scanBtn) scanBtn.disabled = true;
  try {
    const result = await invoke('import:detect');
    S.importBrowsers = result.browsers || [];
    if (!S.importBrowsers.length) {
      profilesEl.innerHTML = '<div class="import-empty">Установленные браузеры с данными не найдены.</div>';
      return;
    }
    showImportStep('list');
    renderImportProfilesForModal();
  } catch (err) {
    profilesEl.innerHTML = `<div class="import-empty error">${cleanError(err)}</div>`;
  } finally {
    if (scanBtn) scanBtn.disabled = false;
  }
}

function showImportStep(step) {
  $$('.import-step', $('#import-modal')).forEach((el) => el.classList.add('hidden'));
  $(`#import-step-${step}`, $('#import-modal'))?.classList.remove('hidden');
}

function renderImportProfilesForModal() {
  const profilesEl = $('#import-profiles');
  if (!profilesEl || !S.importBrowsers) return;
  profilesEl.innerHTML = S.importBrowsers.map((browser) => `
    <div class="import-profile" data-import-id="${esc(browser.id)}">
      <div class="import-profile-main">
        <div class="import-profile-title">${esc(browser.name)} <span>${esc(browser.profile)}</span></div>
        <div class="import-profile-sub">
          ${browser.hasTabs ? 'вкладки' : ''} ${browser.hasTabs && browser.hasPasswords ? '·' : ''} ${browser.hasPasswords ? 'пароли' : browser.kind === 'firefox' ? 'пароли Firefox (NSS)' : ''} ${browser.hasBookmarks ? '· закладки' : ''} ${browser.hasHistory ? '· история' : ''}
        </div>
      </div>
      <label class="import-check"><input type="checkbox" data-profile-select checked> Выбрать</label>
    </div>
  `).join('');
}

function bindImportModalEvents() {
  const modalEl = $('#import-modal');
  if (!modalEl) return;
  modalEl.querySelector('[data-import-close]')?.addEventListener('click', closeImportModal);
  modalEl.querySelector('[data-import-close-done]')?.addEventListener('click', closeImportModal);
  modalEl.querySelector('[data-import-back]')?.addEventListener('click', () => showImportStep('scan'));
  modalEl.querySelector('[data-import-scan]')?.addEventListener('click', scanBrowsersForModal);
  modalEl.querySelector('[data-import-run]')?.addEventListener('click', runImportFromModal);
  modalEl.querySelector('[data-import-csv]')?.addEventListener('click', importPasswordsCsv);
  modalEl.addEventListener('click', (e) => { if (e.target === modalEl || e.target.classList.contains('import-modal-overlay')) closeImportModal(); });
}

// Импорт паролей из CSV, который браузер отдаёт при экспорте.
async function importPasswordsCsv() {
  const buttons = $$('[data-import-csv], [data-import-csv-inline]');
  buttons.forEach((button) => { button.disabled = true; });
  try {
    const result = await invoke('import:passwords-csv');
    if (!result || result.canceled) return;
    const parts = [plural(result.added || 0, 'пароль', 'пароли', 'паролей')];
    if (result.duplicate) parts.push(`повторов: ${result.duplicate}`);
    if (result.failed) parts.push(`ошибок: ${result.failed}`);
    toast(`Пароли из ${result.file || 'CSV'}: ${parts.join(', ')}`, 'success');
    if (result.warnings && result.warnings.length) {
      toast(result.warnings.slice(0, 2).join(' · '), 'info');
    }
    showImportStep('done');
    const text = $('#import-result-text');
    if (text) {
      const base = lastImportSummary.replace(/^Импортировано:\s*/, '').replace(/,\s*$/, '');
      const added = `паролей: ${result.added || 0}`;
      text.textContent = base ? `Импортировано: ${base}, ${added}` : `Импортировано: ${added}`;
    }
    // Предупреждение об app-bound больше неактуально — пароли загружены.
    const note = $('#import-warnings');
    if (note) {
      const row = note.querySelector('.import-warn-row');
      if (row) row.remove();
      if (!note.children.length) note.classList.add('hidden');
    }
    loadPasswords($('#panel-body'));
    await refreshState();
  } catch (err) {
    toast(cleanError(err), 'error');
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

function closeImportModal() {
  const modalEl = $('#import-modal');
  if (modalEl) {
    modalEl.classList.add('hidden');
    modalEl.innerHTML = '';
  }
  S.importBrowsers = null;
}

async function runImportFromModal() {
  const selectedProfiles = $$('[data-profile-select]:checked', $('#import-modal')).map((cb) => cb.closest('.import-profile').dataset.importId);
  const types = {
    bookmarks: !!$('[data-import-type="bookmarks"]')?.checked,
    passwords: !!$('[data-import-type="passwords"]')?.checked,
    history: !!$('[data-import-type="history"]')?.checked,
    tabs: !!$('[data-import-type="tabs"]')?.checked,
  };
  if (!selectedProfiles.length) { toast('Выберите хотя бы один профиль'); return; }
  showImportStep('progress');
  const progressFill = $('#import-progress-fill');
  const progressText = $('#import-progress-text');
  let totalDone = 0;
  let totalTabs = 0, totalPasswords = 0, totalBookmarks = 0, totalHistory = 0;
  let foundBookmarks = 0, foundHistory = 0;
  let appBoundTotal = 0;
  const allWarnings = [];
  for (const profileId of selectedProfiles) {
    const browser = S.importBrowsers.find((b) => b.id === profileId);
    if (!browser) continue;
    progressText.textContent = `Импорт из ${browser.name} (${browser.profile})…`;
    try {
      const result = await invoke('import:run', { id: profileId, tabs: types.tabs, passwords: types.passwords, bookmarks: types.bookmarks, history: types.history });
      totalTabs += result.tabs?.opened || 0;
      totalPasswords += result.passwords?.added || 0;
      totalBookmarks += result.bookmarks?.added || 0;
      totalHistory += result.history?.added || 0;
      foundBookmarks += result.bookmarks?.total || 0;
      foundHistory += result.history?.found || 0;
      appBoundTotal += result.appBound || 0;
      if (result.warnings && result.warnings.length) allWarnings.push(...result.warnings);
    } catch (err) {
      toast(`Ошибка импорта ${browser.name}: ${cleanError(err)}`, 'error');
    }
    totalDone++;
    if (progressFill) progressFill.style.width = `${Math.round((totalDone / selectedProfiles.length) * 100)}%`;
  }
  showImportStep('done');
  const parts = [];
  if (totalTabs) parts.push(plural(totalTabs, 'вкладка', 'вкладки', 'вкладок'));
  if (totalPasswords) parts.push(plural(totalPasswords, 'пароль', 'пароли', 'паролей'));
  if (totalBookmarks) parts.push(plural(totalBookmarks, 'закладка', 'закладки', 'закладок'));
  if (totalHistory) parts.push(plural(totalHistory, 'запись истории', 'записи истории', 'записей истории'));
  let resultText;
  if (parts.length) {
    resultText = `Импортировано: ${parts.join(', ')}`;
  } else if (foundBookmarks || foundHistory) {
    // Данные нашлись, но всё это уже было в базе.
    const found = [];
    if (foundBookmarks) found.push(plural(foundBookmarks, 'закладка', 'закладки', 'закладок'));
    if (foundHistory) found.push(plural(foundHistory, 'запись истории', 'записи истории', 'записей истории'));
    resultText = `Новых записей нет — ${found.join(' и ')} уже были в базе.`;
  } else {
    resultText = 'Данных для импорта не найдено.';
  }
  lastImportSummary = resultText;
  const resultEl = $('#import-result-text');
  if (resultEl) resultEl.textContent = resultText;
  toast(resultText, 'success');

  const unique = [...new Set(allWarnings)];
  const note = $('#import-warnings');
  if (note) {
    const blocks = [];
    if (appBoundTotal) {
      blocks.push(
        `<div class="import-warn-row">`
        + `<div class="import-warn-text">`
        + `<b>${esc(plural(appBoundTotal, 'пароль защищён', 'пароля защищены', 'паролей защищены'))}</b> `
        + `app-bound шифрованием Chrome 127+ — их нельзя прочитать из файла профиля.`
        + `</div>`
        + `<button class="btn" data-import-csv-inline>${icon('import')} Импорт из CSV</button>`
        + `</div>`,
      );
    }
    for (const w of unique) blocks.push(`<div class="import-warn-text">${esc(w)}</div>`);
    if (blocks.length) {
      note.classList.remove('hidden');
      note.innerHTML = blocks.join('');
      note.querySelector('[data-import-csv-inline]')?.addEventListener('click', importPasswordsCsv);
    }
  }
  if (unique.length) toast(unique.slice(0, 2).join(' · '), 'info');
  if (totalPasswords) loadPasswords($('#panel-body'));
  await refreshState();
}

async function loadPasswords(body = $('#panel-body')) {
  const summary = $('#password-summary', body);
  const list = $('#password-list', body);
  if (!summary || !list) return;
  try {
    const result = await invoke('passwords:list');
    S.passwords = result;
    if (result.locked) {
      summary.textContent = 'Хранилище паролей заблокировано. Введите мастер-пароль, чтобы увидеть список.';
      list.innerHTML = `
        <div class="password-row">
          <div class="password-main">
            <div class="password-origin">Введите мастер-пароль</div>
          </div>
          <input class="input" type="password" id="password-unlock" placeholder="Мастер-пароль" style="max-width:220px">
          <button class="icon-btn" data-password-unlock title="Разблокировать">${icon('lock')}</button>
        </div>`;
      const doUnlock = async () => {
        const input = $('#password-unlock', list);
        if (!input || !input.value) return;
        try {
          await invoke('passwords:unlock', { master: input.value });
          toast('Хранилище разблокировано', 'success');
          loadPasswords(body);
        } catch (err) {
          toast(cleanError(err), 'error');
        }
      };
      $('[data-password-unlock]', list)?.addEventListener('click', doUnlock);
      $('#password-unlock', list)?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doUnlock();
      });
      return;
    }
    summary.textContent = result.total
      ? `Сохранено паролей: ${result.total}. ${result.hasMaster ? 'Файл зашифрован мастер-паролем (AES-256-GCM).' : 'Они зашифрованы через Windows DPAPI.'}`
      : 'Пока пусто. Импортируйте пароли из установленного браузера.';
    if (!result.total) {
      list.innerHTML = '';
      return;
    }
    list.innerHTML = result.items.slice(0, 60).map((item) => `
      <div class="password-row" data-password-id="${esc(item.id)}">
        <div class="password-main">
          <div class="password-origin">${esc(item.origin)}</div>
          <div class="password-user">${esc(item.username)}</div>
        </div>
        <button class="icon-btn" title="Заполнить на странице" data-password-fill>${icon('key')}</button>
        <button class="icon-btn" title="Скопировать пароль" data-password-copy>${icon('external')}</button>
        <button class="icon-btn danger" title="Удалить" data-password-delete>${icon('trash')}</button>
      </div>
    `).join('');
    $$('[data-password-fill]', list).forEach((button) => {
      button.addEventListener('click', async () => {
        const id = button.closest('.password-row').dataset.passwordId;
        try {
          const ok = await invoke('passwords:fill', { id });
          toast(ok ? 'Пароль подставлен в форму' : 'На странице нет поля пароля', ok ? 'success' : 'error');
        } catch (err) {
          toast(cleanError(err), 'error');
        }
      });
    });
    $$('[data-password-copy]', list).forEach((button) => {
      button.addEventListener('click', async () => {
        const id = button.closest('.password-row').dataset.passwordId;
        const ok = await invoke('passwords:copy', { id });
        toast(ok ? 'Пароль скопирован' : 'Не удалось расшифровать пароль', ok ? 'success' : 'error');
      });
    });
    $$('[data-password-delete]', list).forEach((button) => {
      button.addEventListener('click', async () => {
        const id = button.closest('.password-row').dataset.passwordId;
        await invoke('passwords:remove', { id });
        toast('Пароль удалён');
        loadPasswords(body);
      });
    });
  } catch (err) {
    summary.textContent = cleanError(err);
  }
}

async function importTelegramProxies() {
  const button = $('[data-action="telegram-proxies"]');
  if (button) button.disabled = true;
  toast('Загружаю последний релиз Telegram Proxy Collector…');
  try {
    const result = await invoke('telegram:import-proxies', { limit: 200 });
    const text = result.fresh
      ? `В релизе ${result.total} прокси, новых ${result.fresh}, передано в Telegram ${result.opened}. Подтвердите добавление в Telegram Desktop.`
      : `Все ${result.total} прокси уже передавались ранее — дубликатов нет.`;
    toast(text, result.errors.length ? 'error' : 'success');
    if (result.errors.length) toast(result.errors.join(' · '), 'error');
  } catch (err) {
    toast(cleanError(err), 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

async function copyTelegramProxies() {
  try {
    const result = await invoke('telegram:copy-proxies');
    toast(`Скопировано ссылок: ${result.count}`, 'success');
  } catch (err) {
    toast(cleanError(err), 'error');
  }
}

async function applySetting(key, value) {
  try {
    const settings = await invoke('settings:set', { [key]: value });
    if (S.data) S.data.settings = settings;
    if (key === 'tabPosition') applyTabPosition(value);
    if (key === 'showBookmarksBar') renderBookmarksBar();
    if (key === 'compactToolbar') {
      const compact = !!value;
      document.body.classList.toggle('toolbar-collapsed', compact);
      const collapse = $('#toolbar-collapse');
      const expand = $('#toolbar-expand');
      if (collapse) collapse.classList.toggle('hidden', compact);
      if (expand) expand.classList.toggle('hidden', !compact);
      scheduleChromeLayout();
    }
    if (key === 'downloadDir') {
      const label = document.getElementById('download-dir-value');
      if (label) label.textContent = value || 'Системная папка «Загрузки»';
    }
    if (key === 'passwordAutoLockMinutes') {
      invoke('passwords:auto-lock', { minutes: Number(value) || 0 }).catch(() => {});
    }
    if (['doh', 'dohServer', 'fingerprintProtection'].includes(key)) {
      toast('Изменение вступит в силу после перезапуска браузера');
    }
  } catch (err) {
    toast(cleanError(err), 'error');
  }
}

async function clearData(includeHistory) {
  const ok = window.confirm(
    'Удалить cookies, кеш, localStorage и историю?\n\nЗакладки, настройки и сохранённые пароли не затрагиваются.',
  );
  if (!ok) return;
  try {
    await invoke('privacy:clear', { history: !!includeHistory });
    toast('Данные браузера очищены');
    await refreshState();
    if (S.mode === 'settings') renderPanel('settings');
  } catch (err) {
    toast(cleanError(err), 'error');
  }
}

/* ------------------------------------------------------------------ vpn */
function protocolLabel(protocol) {
  return protocol === 'ss' ? 'SS' : protocol.toUpperCase();
}

function latencyClass(ms) {
  if (ms == null) return '';
  if (ms < 120) return 'good';
  if (ms < 350) return 'mid';
  return 'bad';
}

function renderVpn(body, token) {
  const v = S.data.vpn;
  const active = v.active;
  const connected = v.connected;
  const connecting = v.connecting;
  const servers = v.servers || [];

  const hero = `
    ${!v.coreAvailable ? `<div class="info-box warn">${icon('alert')}<div>Xray core не найден в <code>resources/xray/xray.exe</code>. VPN не сможет подключиться. Переустановите браузер или положите xray.exe и geoip/geosite рядом.</div></div>` : ''}
    <div class="vpn-hero">
      <div class="vpn-hero-top">
        <div class="vpn-status">
          <div class="vpn-status-icon ${connected ? 'on' : ''}">${icon('shield')}</div>
          <div>
            <div class="vpn-status-name">${connected && active ? esc(active.name) : connecting ? 'Подключение…' : 'VPN выключен'}</div>
            <div class="vpn-status-sub">${connected && active ? esc(active.address + ':' + active.port) : 'Весь трафик браузера идёт напрямую'}</div>
          </div>
        </div>
        <span class="vpn-state-pill ${connected ? 'on' : ''}"><span class="vpn-state-dot"></span>${connected ? 'Защищено' : connecting ? 'Подключение' : 'Отключено'}</span>
      </div>
      ${connected ? `<div class="vpn-meta">
        <div>Протокол<b>${active ? protocolLabel(active.protocol) : '—'}</b></div>
        <div>SOCKS5<b>127.0.0.1:${v.socksPort}</b></div>
        <div>HTTP<b>127.0.0.1:${v.httpPort}</b></div>
        <div>Аптайм<b>${fmtUptime(v.uptime)}</b></div>
      </div>` : ''}
      ${v.error ? `<div class="vpn-error">${esc(v.error)}</div>` : ''}
      <div class="btn-row">
        <button class="btn primary" data-vpn="toggle" ${connecting ? 'disabled' : ''}>
          ${connected ? 'Отключить' : connecting ? 'Подключение…' : 'Подключить'}
        </button>
        <button class="btn" data-vpn="test" ${connected ? '' : 'disabled'}>${icon('globe')} Проверить соединение</button>
      </div>
      <label class="vpn-auto">
        <span class="switch"><input type="checkbox" data-vpn-auto ${S.data.settings.vpnAutoConnect ? 'checked' : ''}><span class="slider"></span></span>
        <span>Подключаться автоматически при запуске браузера</span>
      </label>
    </div>
  `;

  const serverRows = servers.length
    ? servers.map((srv) => `
        <div class="server-row" data-server="${esc(srv.id)}">
          <div class="server-radio ${srv.id === v.activeId ? 'selected' : ''}" data-select="${esc(srv.id)}" title="Выбрать сервер"></div>
          <div class="server-main">
            <div class="server-name">${esc(srv.name || srv.address)}</div>
            <div class="server-addr">${esc(srv.address)}:${srv.port} <span class="proto-badge">${protocolLabel(srv.protocol)}</span></div>
          </div>
          <div class="server-latency ${latencyClass(srv.latency)}">${srv.latency != null ? srv.latency + ' мс' : srv.latencyError ? 'ошибка' : '—'}</div>
          <div class="server-actions">
            <button class="icon-btn" data-ping="${esc(srv.id)}" title="Проверить пинг">${icon('reload')}</button>
            <button class="icon-btn" data-delete="${esc(srv.id)}" title="Удалить сервер">${icon('trash')}</button>
          </div>
        </div>`).join('')
    : renderEmpty('server', 'Серверов пока нет', 'Добавьте ссылку VLESS, VMess, Trojan или Shadowsocks ниже.');

  const subs = (v.subscriptions || []).length
    ? `<div class="btn-row" style="margin:0 0 16px 4px">${v.subscriptions.map((s) => `<span class="proto-badge" title="${esc(s.url)}">${esc(s.name)} · ${s.count}</span>`).join(' ')}</div>`
    : '';

  body.innerHTML = `
    ${hero}
    <div class="section-label">Серверы · ${servers.length}</div>
    <div class="card">${serverRows}</div>
    ${subs}
    <div class="section-label">Добавить сервер</div>
    <div class="add-grid">
      <div class="add-box">
        <h3>Ссылка на сервер</h3>
        <p>Вставьте одну или несколько ссылок — по одной в строке.</p>
        <textarea id="vpn-link" placeholder="vless://uuid@host:443?security=tls&amp;type=ws&amp;path=/ws#Мой сервер"></textarea>
        <button class="btn" data-vpn="add-link">${icon('plus')} Добавить</button>
      </div>
      <div class="add-box">
        <h3>Подписка</h3>
        <p>URL подписки (base64 или список ссылок).</p>
        <input class="text-input" id="vpn-sub" type="text" placeholder="https://example.com/sub/...">
        <button class="btn" data-vpn="add-sub">${icon('download')} Загрузить</button>
      </div>
    </div>
    <div class="info-box" style="margin-top:16px">${icon('info')}<div>
      Поддерживаются VLESS (включая Reality и XHTTP), VMess, Trojan, Shadowsocks, SOCKS5 и HTTP-прокси.
      VPN работает через встроенный Xray core: браузер направляет трафик в локальный SOCKS5, DNS не утекает.
      Отключение VPN мгновенно возвращает прямое соединение.
    </div></div>
  `;

  S.vpnJson = JSON.stringify(v);

  const toggleBtn = $('[data-vpn="toggle"]', body);
  if (toggleBtn) {
    toggleBtn.addEventListener('click', async () => {
      toggleBtn.disabled = true;
      try {
        if (connected) await invoke('vpn:disconnect');
        else await invoke('vpn:connect');
      } catch (err) {
        toast(cleanError(err), 'error');
      }
      await refreshState();
      if (S.mode === 'vpn' && token === S.panelToken) renderPanel('vpn');
    });
  }

  const testBtn = $('[data-vpn="test"]', body);
  if (testBtn) {
    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true;
      testBtn.textContent = 'Проверка…';
      try {
        const result = await invoke('vpn:test-connection');
        if (result.ok) {
          const ip = result.ip ? ` · IP ${result.ip}` : '';
          toast(`Соединение работает · ${result.ms} мс${ip} · HTTP ${result.status}`);
        } else {
          toast(`Проверка не удалась: ${result.error || 'нет ответа'}`, 'error');
        }
      } catch (err) {
        toast(cleanError(err), 'error');
      }
      if (S.mode === 'vpn' && token === S.panelToken) renderPanel('vpn');
    });
  }

  const autoBox = $('[data-vpn-auto]', body);
  if (autoBox) {
    autoBox.addEventListener('change', async () => {
      if (autoBox.checked && !servers.length) {
        autoBox.checked = false;
        toast('Сначала добавьте сервер', 'error');
        return;
      }
      try {
        await invoke('settings:set', { vpnAutoConnect: autoBox.checked });
        toast(autoBox.checked ? 'VPN будет подключаться при запуске' : 'Автоподключение выключено');
      } catch (err) {
        autoBox.checked = !autoBox.checked;
        toast(cleanError(err), 'error');
      }
    });
  }

  $$('[data-select]', body).forEach((el) => {
    el.addEventListener('click', async () => {
      try {
        await invoke('vpn:select', { id: el.dataset.select });
        await refreshState();
        if (S.mode === 'vpn') renderPanel('vpn');
      } catch (err) {
        toast(cleanError(err), 'error');
      }
    });
  });

  $$('[data-ping]', body).forEach((el) => {
    el.addEventListener('click', async () => {
      el.disabled = true;
      try {
        const result = await invoke('vpn:test', { id: el.dataset.ping });
        if (result.ok) toast(`Пинг: ${result.ms} мс`);
        else toast(`Сервер не отвечает: ${result.error}`, 'error');
      } catch (err) {
        toast(cleanError(err), 'error');
      }
      await refreshState();
      if (S.mode === 'vpn') renderPanel('vpn');
    });
  });

  $$('[data-delete]', body).forEach((el) => {
    el.addEventListener('click', async () => {
      const id = el.dataset.delete;
      const srv = servers.find((s) => s.id === id);
      if (!window.confirm(`Удалить сервер «${srv ? srv.name : id}»?`)) return;
      try {
        await invoke('vpn:remove', { id });
        toast('Сервер удалён');
      } catch (err) {
        toast(cleanError(err), 'error');
      }
      await refreshState();
      if (S.mode === 'vpn') renderPanel('vpn');
    });
  });

  const addBtn = $('[data-vpn="add-link"]', body);
  if (addBtn) {
    addBtn.addEventListener('click', async () => {
      const textarea = $('#vpn-link', body);
      const text = textarea.value.trim();
      if (!text) {
        toast('Вставьте ссылку на сервер', 'error');
        return;
      }
      try {
        const result = await invoke('vpn:add', { text });
        if (result.added) toast(`Добавлено серверов: ${result.added}`);
        if (result.errors && result.errors.length) {
          toast(result.errors[0], 'error');
        }
        if (!result.added && !(result.errors || []).length) toast('Такие серверы уже есть');
      } catch (err) {
        toast(cleanError(err), 'error');
      }
      await refreshState();
      if (S.mode === 'vpn') renderPanel('vpn');
    });
  }

  const subBtn = $('[data-vpn="add-sub"]', body);
  if (subBtn) {
    subBtn.addEventListener('click', async () => {
      const input = $('#vpn-sub', body);
      const url = input.value.trim();
      if (!/^https?:\/\//i.test(url)) {
        toast('Введите http(s)-ссылку подписки', 'error');
        return;
      }
      subBtn.disabled = true;
      subBtn.textContent = 'Загрузка…';
      try {
        const result = await invoke('vpn:add-subscription', { url });
        toast(`Подписка загружена: ${result.added} серверов`);
        if (result.errors && result.errors.length) toast(result.errors[0], 'error');
      } catch (err) {
        toast(cleanError(err), 'error');
      }
      await refreshState();
      if (S.mode === 'vpn') renderPanel('vpn');
    });
  }
}

/* ------------------------------------------------------------------ extensions */
function renderExtensions(body) {
  const list = S.data.extensions || [];
  const enabled = list.filter((e) => e.enabled).length;

  body.innerHTML = `
    <div class="toolbar-line">
      <button class="btn primary" data-ext="load">${icon('plus')} Загрузить распакованное</button>
      <button class="btn" data-ext="folder">${icon('folder')} Открыть папку</button>
      <div class="spacer"></div>
      <span style="color:#8a99ae;font-size:12px">${enabled} из ${list.length} включено</span>
    </div>
    <div class="info-box">${icon('puzzle')}<div>
      Поддерживаются распакованные расширения Chromium (Manifest V2/V3). Магазин Chrome не встроен: скачайте
      расширение, распакуйте и загрузите папку. После включения выключенного расширения перезапустите браузер.
      uBlock Origin уже включён. Расширения не загружаются в приватных окнах.
    </div></div>
    <div class="card" id="ext-list"></div>
  `;

  $('[data-ext="load"]', body).addEventListener('click', async () => {
    try {
      const item = await invoke('extensions:pick');
      if (item) toast(`Расширение «${item.name}» загружено`);
    } catch (err) {
      toast(cleanError(err), 'error');
    }
    await refreshState();
    if (S.mode === 'extensions') renderPanel('extensions');
  });

  $('[data-ext="folder"]', body).addEventListener('click', () => {
    invoke('extensions:open-folder').catch(() => {});
  });

  const container = $('#ext-list', body);
  if (!list.length) {
    container.innerHTML = renderEmpty('puzzle', 'Расширения не установлены', 'Загрузите папку с manifest.json.');
    return;
  }

  container.innerHTML = list.map((ext) => `
    <div class="ext-row ${ext.enabled ? '' : 'ext-off'}">
      <div class="ext-icon">${icon('puzzle')}</div>
      <div class="ext-main">
        <div class="ext-name">${esc(ext.name)}${ext.version ? ` <span style="color:#64748b;font-size:11px">v${esc(ext.version)}</span>` : ''}${ext.bundled ? ' <span class="ext-badge">встроенное</span>' : ''}</div>
        <div class="ext-meta">${esc(ext.path)}</div>
        ${ext.error ? `<div class="ext-error">${esc(ext.error)}</div>` : ''}
      </div>
      <div class="ext-actions">
        ${ext.enabled && ext.id && ext.optionsPage ? `<button class="icon-btn" data-ext-options="${esc(ext.id)}/${esc(ext.optionsPage)}" title="Настройки расширения">${icon('settings')}</button>` : ''}
        <label class="switch" title="${ext.enabled ? 'Отключить' : 'Включить'}">
          <input type="checkbox" data-ext-toggle="${esc(ext.folder)}" ${ext.enabled ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
        ${ext.bundled ? '' : `<button class="icon-btn" data-ext-remove="${esc(ext.folder)}" title="Удалить">${icon('trash')}</button>`}
      </div>
    </div>
  `).join('');

  $$('[data-ext-options]', container).forEach((btn) => {
    btn.addEventListener('click', () => {
      const [id, ...page] = btn.dataset.extOptions.split('/');
      const url = `chrome-extension://${id}/${page.join('/')}`;
      invoke('tabs:create', { url }).catch((err) => toast(cleanError(err), 'error'));
    });
  });

  $$('[data-ext-toggle]', container).forEach((input) => {
    input.addEventListener('change', async () => {
      try {
        await invoke('extensions:toggle', { folder: input.dataset.extToggle, enabled: input.checked });
        toast(input.checked ? 'Расширение включено — перезапустите браузер' : 'Расширение отключено');
      } catch (err) {
        toast(cleanError(err), 'error');
      }
      await refreshState();
      if (S.mode === 'extensions') renderPanel('extensions');
    });
  });

  $$('[data-ext-remove]', container).forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!window.confirm('Удалить расширение и его папку?')) return;
      try {
        await invoke('extensions:remove', { folder: btn.dataset.extRemove });
        toast('Расширение удалено');
      } catch (err) {
        toast(cleanError(err), 'error');
      }
      await refreshState();
      if (S.mode === 'extensions') renderPanel('extensions');
    });
  });
}

/* ------------------------------------------------------------------ history */
async function renderHistory(body, token) {
  body.innerHTML = `
    <div class="toolbar-line">
      <input class="text-input" id="history-search" type="text" placeholder="Поиск по истории…">
      <div class="spacer"></div>
      <button class="btn danger" data-history="clear">${icon('trash')} Очистить историю</button>
    </div>
    <div id="history-list"><div class="empty">Загрузка…</div></div>
  `;

  const input = $('#history-search', body);
  const list = $('#history-list', body);

  const load = async (query) => {
    try {
      const items = await invoke('history:list', { query, limit: 400 });
      if (token !== S.panelToken) return;
      if (!items.length) {
        list.innerHTML = renderEmpty('history', query ? 'Ничего не найдено' : 'История пуста', query ? 'Попробуйте другой запрос.' : 'Посещённые страницы появятся здесь.');
        return;
      }
      let html = '';
      let lastDay = null;
      for (const item of items) {
        const day = dayLabel(item.ts);
        if (day !== lastDay) {
          html += `<div class="date-label">${esc(day)}</div>`;
          lastDay = day;
        }
        html += `<div class="list-row">
          <div class="list-main" data-url="${esc(item.url)}">
            <div class="list-title">${esc(item.title || item.url)}</div>
            <div class="list-sub">${esc(hostOf(item.url))}</div>
          </div>
          <div class="list-time">${fmtTime(item.ts)}</div>
        </div>`;
      }
      list.innerHTML = html;
      $$('[data-url]', list).forEach((row) => {
        row.addEventListener('click', async () => {
          await invoke('tabs:navigate', { url: row.dataset.url });
          setPanel('web');
        });
      });
    } catch (err) {
      list.innerHTML = `<div class="empty">${esc(cleanError(err))}</div>`;
    }
  };

  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => load(input.value.trim()), 150);
  });

  $('[data-history="clear"]', body).addEventListener('click', async () => {
    if (!window.confirm('Очистить всю историю посещений?')) return;
    try {
      await invoke('history:clear');
      toast('История очищена');
      load('');
    } catch (err) {
      toast(cleanError(err), 'error');
    }
  });

  await load('');
}

/* ------------------------------------------------------------------ bookmarks */
// Контекстные меню рисует главный процесс нативным меню: HTML-слой всегда
// оказывается под нативной WebContentsView страницы, поэтому DOM-меню было
// видно только в пределах панели инструментов.
async function showNativeMenu(event, items) {
  try {
    return await invoke('ui:context-menu', {
      x: Math.round(event && event.clientX ? event.clientX : 0),
      y: Math.round(event && event.clientY ? event.clientY : 0),
      items,
    });
  } catch {
    return null;
  }
}

// Диалоги с полями ввода тоже нужно показать поверх страницы: на время
// открытия убираем нативную страницу и возвращаем её после закрытия.
let pageHiddenHolds = 0;
function holdPageHidden(hide) {
  pageHiddenHolds = Math.max(0, pageHiddenHolds + (hide ? 1 : -1));
  invoke('ui:overlay', { open: pageHiddenHolds > 0 }).catch(() => {});
}

/* ------------------------------------------------------------------ текстовые поля */
// Контекстное меню для input/textarea интерфейса (в том числе для поля
// «Добавить торрент»). В Electron у HTML-полей по умолчанию нет меню,
// поэтому копировать/вставлять можно было только горячими клавишами.
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', 'password']);

function isUiTextInput(el) {
  if (!el || !el.tagName || el.disabled) return false;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return false;
  const type = String(el.getAttribute('type') || 'text').toLowerCase();
  return TEXT_INPUT_TYPES.has(type);
}

async function showUiTextMenu(event, el) {
  const start = el.selectionStart == null ? 0 : el.selectionStart;
  const end = el.selectionEnd == null ? 0 : el.selectionEnd;
  const hasSelection = end > start;
  const readOnly = !!el.readOnly;
  const picked = await showNativeMenu(event, [
    { id: 'undo', label: 'Отменить', accelerator: 'Ctrl+Z', enabled: !readOnly },
    { id: 'redo', label: 'Вернуть', accelerator: 'Ctrl+Y', enabled: !readOnly },
    { type: 'separator' },
    { id: 'cut', label: 'Вырезать', accelerator: 'Ctrl+X', enabled: hasSelection && !readOnly },
    { id: 'copy', label: 'Копировать', accelerator: 'Ctrl+C', enabled: hasSelection },
    { id: 'paste', label: 'Вставить', accelerator: 'Ctrl+V', enabled: !readOnly },
    { type: 'separator' },
    { id: 'select-all', label: 'Выделить всё', accelerator: 'Ctrl+A' },
  ]);
  if (!picked) return;
  el.focus();
  const fireInput = () => {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  if (picked === 'select-all') {
    el.select();
    return;
  }
  if (picked === 'undo' || picked === 'redo') {
    try { document.execCommand(picked); } catch {}
    return;
  }
  if (picked === 'copy' || picked === 'cut') {
    const text = el.value.slice(start, end);
    if (text) invoke('clipboard:write-text', { text }).catch(() => {});
    if (picked === 'cut' && text) {
      el.setRangeText('', start, end, 'end');
      fireInput();
    }
    return;
  }
  if (picked === 'paste') {
    let text = '';
    try { text = String(await invoke('clipboard:read-text') || ''); } catch {}
    if (!text) return;
    if (el.tagName === 'INPUT') text = text.replace(/[\r\n]+/g, ' ');
    el.setRangeText(text, start, end, 'end');
    fireInput();
  }
}

function bindUiTextContextMenu() {
  document.addEventListener('contextmenu', (event) => {
    if (event.defaultPrevented) return;
    const el = event.target;
    if (!isUiTextInput(el) || el.id === 'omnibox') return;
    event.preventDefault();
    showUiTextMenu(event, el).catch(() => {});
  });
}

// Диалог с несколькими полями — для редактирования закладки.
function formDialog(title, fields, { hint = '' } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'import-modal-overlay';
    overlay.innerHTML = `
      <div class="import-modal-card" style="width:min(440px,92vw)">
        <div class="import-modal-head">
          <div class="import-modal-title">${esc(title)}</div>
          <button class="icon-btn" data-form-close title="Закрыть">${icon('close')}</button>
        </div>
        <div class="import-modal-body">
          ${hint ? `<div class="import-desc">${esc(hint)}</div>` : ''}
          ${fields.map((field) => `
            <div class="modal-field">
              <label>${esc(field.label || '')}</label>
              <input type="text" data-form-field="${esc(field.name)}" value="${esc(field.value || '')}" placeholder="${esc(field.placeholder || '')}">
            </div>`).join('')}
          <div class="import-modal-actions">
            <button class="btn" data-form-close>Отмена</button>
            <button class="btn primary" data-form-save>Сохранить</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    holdPageHidden(true);
    const first = overlay.querySelector('[data-form-field]');
    const close = (result) => {
      if (!overlay.isConnected) return;
      overlay.remove();
      holdPageHidden(false);
      resolve(result);
    };
    const save = () => {
      const values = {};
      overlay.querySelectorAll('[data-form-field]').forEach((input) => {
        values[input.dataset.formField] = input.value.trim();
      });
      close(values);
    };
    overlay.querySelectorAll('[data-form-close]').forEach((b) => b.addEventListener('click', () => close(null)));
    overlay.querySelector('[data-form-save]').addEventListener('click', save);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
    overlay.querySelectorAll('[data-form-field]').forEach((input) => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); save(); }
        if (e.key === 'Escape') { e.preventDefault(); close(null); }
      });
    });
    if (first) { first.focus(); first.select(); }
  });
}

// Electron не поддерживает window.prompt — свой диалог ввода.
function promptDialog(title, { hint = '', value = '', placeholder = '' } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'import-modal-overlay';
    overlay.innerHTML = `
      <div class="import-modal-card" style="width:min(400px,92vw)">
        <div class="import-modal-head">
          <div class="import-modal-title">${esc(title)}</div>
          <button class="icon-btn" data-prompt-close title="Закрыть">${icon('close')}</button>
        </div>
        <div class="import-modal-body">
          ${hint ? `<div class="import-desc">${esc(hint)}</div>` : ''}
          <div class="modal-field">
            <input type="text" id="prompt-value" value="${esc(value)}" placeholder="${esc(placeholder)}">
          </div>
          <div class="import-modal-actions">
            <button class="btn" data-prompt-close>Отмена</button>
            <button class="btn primary" data-prompt-save>Сохранить</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    holdPageHidden(true);
    const input = overlay.querySelector('#prompt-value');
    const close = (result) => {
      if (!overlay.isConnected) return;
      overlay.remove();
      holdPageHidden(false);
      resolve(result);
    };
    overlay.querySelectorAll('[data-prompt-close]').forEach((b) => b.addEventListener('click', () => close(null)));
    overlay.querySelector('[data-prompt-save]').addEventListener('click', () => close(input.value.trim()));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); close(input.value.trim()); }
      if (e.key === 'Escape') { e.preventDefault(); close(null); }
    });
    input.focus();
    input.select();
  });
}

async function renderBookmarks(body, token) {
  try {
    const tree = await invoke('bookmarks:tree');
    if (token !== S.panelToken) return;
    const folderCount = tree.folders.length;
    const bookmarkCount = tree.bookmarks.length + tree.folders.reduce(
      (sum, folder) => sum + folder.bookmarks.length,
      0,
    );
    if (!bookmarkCount && !folderCount) {
      body.innerHTML = `
        ${renderEmpty('bookmark', 'Закладок пока нет', 'Нажмите★ в адресной строке или Ctrl+D, чтобы сохранить страницу.')}
        <div class="card">
          <div class="setting">
            <div class="setting-text">
              <div class="setting-title">${icon('folder-plus')} Новая папка</div>
              <div class="setting-desc">Папки группируют закладки и показываются на панели закладок.</div>
            </div>
            <div class="setting-control"><button class="btn" data-folder-add>${icon('folder-plus')} Создать</button></div>
          </div>
        </div>`;
      bindBookmarkFolderActions(body, token);
      return;
    }

    const folderRow = (folder) => `
      <div class="bookmark-folder" data-folder-id="${esc(folder.id)}">
        <div class="list-row">
          <div class="ext-icon">${icon('folder')}</div>
          <div class="list-main">
            <div class="list-title">${esc(folder.name)}</div>
            <div class="list-sub">${plural(folder.bookmarks.length, 'закладка', 'закладки', 'закладок')}</div>
          </div>
          <button class="icon-btn" data-folder-rename="${esc(folder.id)}" title="Переименовать">${icon('settings')}</button>
          <button class="icon-btn danger" data-folder-remove="${esc(folder.id)}" title="Удалить папку">${icon('trash')}</button>
        </div>
        ${folder.bookmarks.length ? folder.bookmarks.map((b) => bookmarkRow(b, folder.id)).join('') : ''}
      </div>`;

    body.innerHTML = `
      <div class="toolbar-line">
        <span style="color:#8a99ae;font-size:12px">${bookmarkCount} закладок · ${folderCount} папок</span>
        <div class="spacer"></div>
        <button class="btn" data-folder-add>${icon('folder-plus')} Новая папка</button>
      </div>
      ${folderCount ? `<div class="card">${tree.folders.map(folderRow).join('')}</div>` : ''}
      ${tree.bookmarks.length ? `<div class="card">${tree.bookmarks.map((b) => bookmarkRow(b, '')).join('')}</div>` : ''}
    `;

    bindBookmarkRows(body);
    bindBookmarkFolderActions(body, token);
  } catch (err) {
    body.innerHTML = `<div class="empty">${esc(cleanError(err))}</div>`;
  }
}

function bookmarkRow(b, folderId) {
  return `
    <div class="list-row" data-bookmark-id="${esc(b.id)}">
      <div class="list-main" data-url="${esc(b.url)}">
        <div class="list-title">${esc(b.title || b.url)}</div>
        <div class="list-sub">${esc(b.url)}</div>
      </div>
      <button class="icon-btn" data-bookmark-edit="${esc(b.id)}" title="Редактировать закладку">${icon('edit')}</button>
      <button class="icon-btn" data-bookmark-move="${esc(b.id)}" title="Переместить в папку">${icon('folder')}</button>
      <button class="icon-btn danger" data-bookmark-remove="${esc(b.id)}" title="Удалить">${icon('trash')}</button>
    </div>`;
}

async function editBookmark(id) {
  const list = await invoke('bookmarks:list');
  const current = (list || []).find((b) => b.id === id);
  if (!current) {
    toast('Закладка не найдена', 'error');
    return;
  }
  const values = await formDialog('Редактировать закладку', [
    { name: 'title', label: 'Название', value: current.title || '' },
    { name: 'url', label: 'Адрес', value: current.url || '', placeholder: 'https://example.com' },
  ]);
  if (!values) return;
  if (!values.url) {
    toast('Адрес не может быть пустым', 'error');
    return;
  }
  try {
    await invoke('bookmarks:update', { id, title: values.title, url: values.url });
    toast('Закладка обновлена', 'success');
  } catch (err) {
    toast(cleanError(err), 'error');
  }
}

function bindBookmarkRows(body) {
  $$('[data-url]', body).forEach((row) => {
    row.addEventListener('click', async () => {
      await invoke('tabs:navigate', { url: row.dataset.url });
      setPanel('web');
    });
  });
  $$('[data-bookmark-edit]', body).forEach((btn) => {
    btn.addEventListener('click', async () => {
      await editBookmark(btn.dataset.bookmarkEdit);
      await refreshState();
      if (S.mode === 'bookmarks') renderPanel('bookmarks');
    });
  });
  $$('[data-bookmark-remove]', body).forEach((btn) => {
    btn.addEventListener('click', async () => {
      await invoke('bookmarks:remove', { id: btn.dataset.bookmarkRemove });
      await refreshState();
      renderPanel('bookmarks');
    });
  });
  $$('[data-bookmark-move]', body).forEach((btn) => {
    btn.addEventListener('click', async () => {
      const tree = await invoke('bookmarks:tree');
      const options = [['', 'Без папки'], ...tree.folders.map((f) => [f.id, f.name])];
      const overlay = document.createElement('div');
      overlay.className = 'import-modal-overlay';
      overlay.innerHTML = `
        <div class="import-modal-card">
          <div class="import-modal-head">
            <div class="import-modal-title">Переместить в папку</div>
            <button class="icon-btn" data-move-close title="Закрыть">${icon('close')}</button>
          </div>
          <div class="import-modal-body">
            ${options.map(([id, name]) => `<button class="btn" style="width:100%;justify-content:flex-start;margin-bottom:6px" data-move-to="${esc(id)}">${esc(name)}</button>`).join('')}
          </div>
        </div>`;
      document.body.appendChild(overlay);
      holdPageHidden(true);
      const close = () => {
        if (!overlay.isConnected) return;
        overlay.remove();
        holdPageHidden(false);
      };
      overlay.querySelectorAll('[data-move-close]').forEach((b) => b.addEventListener('click', close));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
      overlay.querySelectorAll('[data-move-to]').forEach((b) => {
        b.addEventListener('click', async () => {
          await invoke('bookmarks:move', { id: btn.dataset.bookmarkMove, folderId: b.dataset.moveTo });
          close();
          await refreshState();
          renderPanel('bookmarks');
        });
      });
    });
  });
}

function bindBookmarkFolderActions(body, token) {
  $('[data-folder-add]', body)?.addEventListener('click', async () => {
    const name = await promptDialog('Новая папка', { placeholder: 'Например, Работа' });
    if (!name) return;
    try {
      await invoke('bookmarks:folder-add', { name });
      toast('Папка создана');
      await refreshState();
      renderPanel('bookmarks');
    } catch (err) {
      toast(cleanError(err), 'error');
    }
  });
  $$('[data-folder-rename]', body).forEach((btn) => {
    btn.addEventListener('click', async () => {
      const tree = await invoke('bookmarks:tree');
      const folder = tree.folders.find((f) => f.id === btn.dataset.folderRename);
      if (!folder) return;
      const name = await promptDialog('Переименовать папку', { value: folder.name });
      if (!name) return;
      await invoke('bookmarks:folder-rename', { id: folder.id, name });
      await refreshState();
      renderPanel('bookmarks');
    });
  });
  $$('[data-folder-remove]', body).forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!window.confirm('Удалить папку? Закладки из неё переедут в корень.')) return;
      await invoke('bookmarks:folder-remove', { id: btn.dataset.folderRemove });
      await refreshState();
      renderPanel('bookmarks');
    });
  });
}

/* ------------------------------------------------------------------ торренты */
const TORRENT = {
  jobs: [],
  stats: {},
  settings: {},
  selected: null,
  filter: 'all',
  tab: 'general',
  details: null,
  body: null,
  token: 0,
  timer: null,
  refreshing: false,
  detailTick: 0,
};

const TORRENT_FILTERS = [
  ['all', 'Все'],
  ['downloading', 'Качаются'],
  ['seeding', 'Раздают'],
  ['paused', 'На паузе'],
  ['error', 'Ошибки'],
];

function fmtSpeed(bytes) {
  return `${fmtBytes(Math.max(0, Number(bytes) || 0))}/с`;
}

function fmtEta(seconds) {
  let left = Math.max(0, Math.round(Number(seconds) || 0));
  if (!left) return '—';
  const days = Math.floor(left / 86400);
  left %= 86400;
  const hours = Math.floor(left / 3600);
  left %= 3600;
  const minutes = Math.floor(left / 60);
  if (days) return `${days} д ${hours} ч`;
  if (hours) return `${hours} ч ${minutes} мин`;
  return `${minutes} мин`;
}

function torrentStateText(job) {
  if (job.state === 'error') return 'Ошибка';
  if (job.state === 'paused') return 'Пауза';
  if (job.state === 'metadata') return 'Получаем метаданные';
  if (job.state === 'seeding') return 'Раздача';
  if (!job.peers && !job.speed) return 'Ищем пиры…';
  return `Скачивание · ${Math.round((job.progress || 0) * 100)}%`;
}

function torrentStateClass(job) {
  if (job.state === 'error') return 'error';
  if (job.state === 'paused') return 'paused';
  if (job.state === 'seeding') return 'seeding';
  return 'downloading';
}

function torrentModal(html) {
  closeTorrentModal();
  const root = document.createElement('div');
  root.id = 'torrent-modal-root';
  root.className = 'torrent-modal';
  root.innerHTML = `<div class="torrent-modal-card">${html}</div>`;
  root.addEventListener('click', (event) => {
    if (event.target === root) closeTorrentModal();
  });
  document.body.appendChild(root);
  return root;
}

function closeTorrentModal() {
  const root = $('#torrent-modal-root');
  if (root) root.remove();
}

function torrentRowsHtml(jobs) {
  if (!jobs.length) {
    return `<div class="torrent-empty">${icon('torrent')}<div>Загрузок нет.</div><div style="margin-top:6px;font-size:11px">Добавьте файл .torrent, magnet-ссылку или адрес трекера.</div></div>`;
  }
  return jobs.map((job) => {
    const percent = Math.round((job.progress || 0) * 100);
    const selected = TORRENT.selected === job.id;
    return `
      <div class="torrent-row${selected ? ' selected' : ''}" data-torrent-id="${esc(job.id)}">
        <div class="ext-icon">${icon('torrent')}</div>
        <div class="torrent-row-main">
          <div class="torrent-row-title">${esc(job.name || 'Без названия')}</div>
          <div class="torrent-row-sub">
            <span class="torrent-state ${torrentStateClass(job)}"><span class="dot"></span>${esc(torrentStateText(job))}</span>
            · ${job.peers || 0} пиров · ${fmtSpeed(job.speed)}
          </div>
          <div class="mini-track"><div class="mini-fill" style="width:${percent}%"></div></div>
          <div class="torrent-row-sub">${fmtBytes(job.downloaded)} из ${fmtBytes(job.total)} · отдано ${fmtBytes(job.uploaded)} · рейтинг ${(job.ratio || 0).toFixed(2)}</div>
        </div>
        <div class="torrent-row-actions">
          <button class="icon-btn" data-torrent-pause="${esc(job.id)}" title="${job.paused ? 'Продолжить' : 'Пауза'}">${icon(job.paused ? 'play' : 'pause')}</button>
          <button class="icon-btn danger" data-torrent-remove="${esc(job.id)}" title="Удалить">${icon('trash')}</button>
        </div>
      </div>`;
  }).join('');
}

function torrentFilteredJobs() {
  const jobs = TORRENT.jobs || [];
  if (TORRENT.filter === 'all') return jobs;
  if (TORRENT.filter === 'downloading') {
    return jobs.filter((job) => job.state === 'downloading' || job.state === 'metadata');
  }
  return jobs.filter((job) => job.state === TORRENT.filter);
}

function updateTorrentStats() {
  const stats = TORRENT.stats || {};
  const jobs = TORRENT.jobs || [];
  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  set('torrent-stat-down', fmtSpeed(stats.downloadSpeed));
  set('torrent-stat-up', fmtSpeed(stats.uploadSpeed));
  set('torrent-stat-active', String(stats.active || 0));
  set('torrent-stat-total', String(jobs.length));
  set('torrent-stat-port', String((TORRENT.settings && TORRENT.settings.port) || '—'));
  const all = $('#torrent-pause-all');
  if (all) {
    const anyActive = jobs.some((job) => !job.paused);
    all.innerHTML = `${icon(anyActive ? 'pause' : 'play')} ${anyActive ? 'Пауза' : 'Продолжить'}`;
  }
  const count = $('#torrent-list-count');
  if (count) {
    const visible = torrentFilteredJobs().length;
    count.textContent = `${visible} из ${jobs.length}`;
  }
}

function renderTorrentList() {
  const list = $('#torrent-list-body');
  if (!list) return;
  const top = list.scrollTop;
  list.innerHTML = torrentRowsHtml(torrentFilteredJobs());
  list.scrollTop = top;
  $$('[data-torrent-id]', list).forEach((row) => {
    row.addEventListener('click', async (event) => {
      if (event.target.closest('[data-torrent-pause]') || event.target.closest('[data-torrent-remove]')) return;
      TORRENT.selected = row.dataset.torrentId;
      TORRENT.detailTick = 0;
      renderTorrentList();
      await renderTorrentDetails();
    });
  });
  $$('[data-torrent-pause]', list).forEach((btn) => {
    btn.addEventListener('click', async (event) => {
      event.stopPropagation();
      const id = btn.dataset.torrentPause;
      const job = TORRENT.jobs.find((item) => item.id === id);
      try {
        await invoke(job && job.paused ? 'torrent:resume' : 'torrent:pause', { id });
        await refreshTorrent();
      } catch (err) {
        toast(cleanError(err), 'error');
      }
    });
  });
  $$('[data-torrent-remove]', list).forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      openTorrentRemove(btn.dataset.torrentRemove);
    });
  });
  updateTorrentStats();
}

async function renderTorrentDetails() {
  const box = $('#torrent-details');
  if (!box) return;
  if (!TORRENT.selected || !TORRENT.jobs.some((job) => job.id === TORRENT.selected)) {
    TORRENT.selected = (TORRENT.jobs[0] && TORRENT.jobs[0].id) || null;
  }
  if (!TORRENT.selected) {
    TORRENT.details = null;
    box.innerHTML = `<div class="torrent-empty">${icon('torrent')}<div>Выберите загрузку, чтобы увидеть подробности.</div></div>`;
    return;
  }
  let data = null;
  try {
    data = await invoke('torrent:details', { id: TORRENT.selected });
  } catch (err) {
    box.innerHTML = `<div class="torrent-empty">${esc(cleanError(err))}</div>`;
    return;
  }
  if (!data) {
    box.innerHTML = `<div class="torrent-empty">Загрузка удалена.</div>`;
    return;
  }
  TORRENT.details = data;
  const job = data.job;
  const tabs = [['general', 'Общее'], ['files', 'Файлы'], ['trackers', 'Трекеры'], ['peers', 'Пиры']];
  let content = '';
  if (TORRENT.tab === 'general') {
    content = `
      <dl class="torrent-kv">
        <dt>Состояние</dt><dd><span class="torrent-state ${torrentStateClass(job)}"><span class="dot"></span>${esc(torrentStateText(job))}</span></dd>
        <dt>Размер</dt><dd>${fmtBytes(job.total)}</dd>
        <dt>Загружено</dt><dd>${fmtBytes(job.downloaded)} (${Math.round((job.progress || 0) * 100)}%)</dd>
        <dt>Отдано</dt><dd>${fmtBytes(job.uploaded)}</dd>
        <dt>Рейтинг</dt><dd>${(job.ratio || 0).toFixed(2)}</dd>
        <dt>Скорость</dt><dd>↓ ${fmtSpeed(job.speed)} · ↑ ${fmtSpeed(job.uploadSpeed)}</dd>
        <dt>Пиры / сиды</dt><dd>${job.peers || 0} / ${job.seeds || 0}</dd>
        <dt>Осталось</dt><dd>${job.state === 'downloading' ? fmtEta(job.eta) : '—'}</dd>
        <dt>Части</dt><dd>${job.done || 0} из ${job.pieces || 0}</dd>
        <dt>Порт</dt><dd>${job.listenPort || TORRENT.settings.port || '—'}</dd>
        <dt>Папка</dt><dd>${esc(job.dir || '')}</dd>
        <dt>Info hash</dt><dd style="font-family:Consolas,monospace;font-size:10.5px">${esc(job.infoHash || '—')}</dd>
      </dl>
      <div class="btn-row">
        <button class="btn small" data-torrent-open>${icon('folder')} Открыть папку</button>
        <button class="btn small" data-torrent-reveal>${icon('search')} Показать файл</button>
        <button class="btn small" data-torrent-toggle>${icon(job.paused ? 'play' : 'pause')} ${job.paused ? 'Продолжить' : 'Пауза'}</button>
        <button class="btn small danger" data-torrent-delete>${icon('trash')} Удалить</button>
      </div>`;
  } else if (TORRENT.tab === 'files') {
    if (!data.files.length) {
      content = `<div class="torrent-details-empty">${job.state === 'metadata' ? 'Ждём метаданные торрента…' : 'Список файлов пуст.'}</div>`;
    } else {
      const selectedCount = data.files.filter((file) => file.selected).length;
      content = `
        <div class="torrent-file" style="border-bottom:1px solid var(--border)">
          <input type="checkbox" id="torrent-select-all" ${selectedCount === data.files.length ? 'checked' : ''}>
          <span class="torrent-file-name" style="color:var(--text)">Выбрано файлов: ${selectedCount} из ${data.files.length}</span>
          <span class="torrent-file-size">${fmtBytes(job.total)}</span>
        </div>
        <div class="torrent-files">
          ${data.files.map((file) => `
            <label class="torrent-file">
              <input class="torrent-file-check" type="checkbox" data-file-index="${file.index}" ${file.selected ? 'checked' : ''}>
              <span class="torrent-file-name" title="${esc(file.path)}">${esc(file.name)}</span>
              <span class="torrent-file-size">${fmtBytes(file.length)}</span>
              <span class="torrent-file-pct">${Math.round((file.progress || 0) * 100)}%</span>
            </label>`).join('')}
        </div>`;
    }
  } else if (TORRENT.tab === 'trackers') {
    const list = (job.trackers || []).map((tracker) => `<div class="torrent-tracker">${esc(tracker)}</div>`).join('');
    content = `
      <div class="torrent-trackers">
        ${list || '<div class="torrent-details-empty">Трекеры не заданы.</div>'}
        <div class="torrent-details-empty" style="padding:12px 0 0;text-align:left">DHT ${TORRENT.settings.dht ? 'включён' : 'выключен'} · трекеры ${TORRENT.settings.useTrackers ? 'включены' : 'выключены'}</div>
      </div>`;
  } else {
    const peers = data.peers || [];
    content = peers.length ? `
      <table class="torrent-peers">
        <thead><tr><th>Адрес</th><th>↓</th><th>↑</th><th>Части</th><th>Статус</th></tr></thead>
        <tbody>${peers.map((peer) => `
          <tr>
            <td>${esc(peer.address || '—')}</td>
            <td>${fmtSpeed(peer.down)}</td>
            <td>${fmtSpeed(peer.up)}</td>
            <td>${peer.pieces}</td>
            <td>${peer.choked ? 'ждём' : 'обмен'}</td>
          </tr>`).join('')}</tbody>
      </table>` : `<div class="torrent-details-empty">Нет подключённых пиров. Идёт поиск через DHT и трекеры…</div>`;
  }

  box.innerHTML = `
    <div class="torrent-details-head">
      <div class="torrent-details-title">${esc(job.name)}</div>
      <div class="torrent-details-sub">${esc(torrentStateText(job))} · ${fmtBytes(job.downloaded)} из ${fmtBytes(job.total)} · ${job.peers || 0} пиров</div>
      <div class="mini-track" style="margin-top:9px"><div class="mini-fill" style="width:${Math.round((job.progress || 0) * 100)}%"></div></div>
    </div>
    <div class="torrent-tabs">
      ${tabs.map(([id, label]) => `<button class="torrent-tab${TORRENT.tab === id ? ' active' : ''}" data-torrent-tab="${id}">${label}</button>`).join('')}
    </div>
    <div class="torrent-details-body" id="torrent-details-body">${content}</div>`;

  $$('[data-torrent-tab]', box).forEach((btn) => {
    btn.addEventListener('click', async () => {
      TORRENT.tab = btn.dataset.torrentTab;
      await renderTorrentDetails();
    });
  });
  $('[data-torrent-open]', box)?.addEventListener('click', () => {
    invoke('torrent:open-dir', { id: job.id }).catch((err) => toast(cleanError(err), 'error'));
  });
  $('[data-torrent-reveal]', box)?.addEventListener('click', () => {
    invoke('torrent:reveal', { id: job.id }).catch(() => {});
  });
  $('[data-torrent-toggle]', box)?.addEventListener('click', async () => {
    try {
      await invoke(job.paused ? 'torrent:resume' : 'torrent:pause', { id: job.id });
      await refreshTorrent();
    } catch (err) {
      toast(cleanError(err), 'error');
    }
  });
  $('[data-torrent-delete]', box)?.addEventListener('click', () => openTorrentRemove(job.id));
  if (TORRENT.tab === 'files') {
    const checks = $$('.torrent-file-check', box);
    const apply = async () => {
      const files = checks.filter((check) => check.checked).map((check) => Number(check.dataset.fileIndex));
      try {
        await invoke('torrent:set-files', { id: job.id, files });
        TORRENT.detailTick = 0;
        await renderTorrentDetails();
      } catch (err) {
        toast(cleanError(err), 'error');
      }
    };
    checks.forEach((check) => check.addEventListener('change', apply));
    const all = $('#torrent-select-all', box);
    if (all) {
      all.addEventListener('change', async () => {
        const files = all.checked ? data.files.map((file) => file.index) : [];
        try {
          await invoke('torrent:set-files', { id: job.id, files });
          TORRENT.detailTick = 0;
          await renderTorrentDetails();
        } catch (err) {
          toast(cleanError(err), 'error');
        }
      });
    }
  }
}

async function refreshTorrent() {
  if (TORRENT.refreshing) return;
  if (TORRENT.token !== S.panelToken || !TORRENT.body || !TORRENT.body.isConnected || S.mode !== 'torrent') {
    clearInterval(TORRENT.timer);
    TORRENT.timer = null;
    return;
  }
  TORRENT.refreshing = true;
  try {
    const data = await invoke('torrent:list');
    if (TORRENT.token !== S.panelToken) return;
    TORRENT.jobs = data.jobs || [];
    TORRENT.stats = data.stats || {};
    TORRENT.settings = data.settings || TORRENT.settings;
    // Пока кнопка в панели нажата, не пересобираем DOM: иначе узел под
    // курсором исчезает между mousedown и click и нажатие «не срабатывает».
    if (!S.panelPointerDown) renderTorrentList();
    TORRENT.detailTick++;
    // Подробности перерисовываем реже, чтобы не мешать выбору файлов.
    if (TORRENT.detailTick % 2 === 0 && !S.panelPointerDown) await renderTorrentDetails();
  } catch (err) {
    // Панель уже могла закрыться — не засоряем интерфейс ошибками таймера.
  } finally {
    TORRENT.refreshing = false;
  }
}

function startTorrentTimer() {
  clearInterval(TORRENT.timer);
  TORRENT.timer = setInterval(refreshTorrent, 1000);
}

function openTorrentAdd() {
  const root = torrentModal(`
    <div class="torrent-modal-title">Добавить торрент</div>
    <div class="torrent-modal-sub">Вставьте magnet-ссылку или адрес .torrent. Можно выбрать файл с диска.</div>
    <textarea id="torrent-add-text" placeholder="magnet:?xt=urn:btih:… или https://example.org/file.torrent"></textarea>
    <div class="torrent-modal-actions">
      <button class="btn" id="torrent-add-file">${icon('folder')} Файл .torrent</button>
      <div class="spacer" style="flex:1"></div>
      <button class="btn" id="torrent-add-cancel">Отмена</button>
      <button class="btn primary" id="torrent-add-ok">${icon('plus')} Добавить</button>
    </div>`);
  $('#torrent-add-cancel', root).addEventListener('click', closeTorrentModal);
  $('#torrent-add-text', root).focus();
  $('#torrent-add-file', root).addEventListener('click', async () => {
    try {
      const res = await invoke('torrent:add-file');
      if (res && !res.canceled) {
        closeTorrentModal();
        toast(`Добавлено загрузок: ${(res.ids || []).length}`);
        await refreshTorrent();
      }
    } catch (err) {
      toast(cleanError(err), 'error');
    }
  });
  const submit = async () => {
    const value = String($('#torrent-add-text', root).value || '').trim();
    if (!value) {
      toast('Вставьте magnet-ссылку или адрес .torrent', 'error');
      return;
    }
    try {
      const res = await invoke('torrent:add-magnet', { magnet: value });
      if (res && res.canceled) return;
      closeTorrentModal();
      toast('Загрузка добавлена');
      await refreshTorrent();
    } catch (err) {
      toast(cleanError(err), 'error');
    }
  };
  $('#torrent-add-ok', root).addEventListener('click', submit);
  $('#torrent-add-text', root).addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) submit();
  });
}

function openTorrentSettings() {
  const s = { ...(TORRENT.settings || {}) };
  const root = torrentModal(`
    <div class="torrent-modal-title">Настройки BitTorrent</div>
    <div class="torrent-modal-sub">Как в Transmission: папка, порт, лимиты и поведение при запуске.</div>
    <div class="modal-field">
      <label>Папка загрузок</label>
      <div style="display:flex;gap:8px">
        <input id="torrent-set-dir" type="text" value="${esc(s.dir || '')}" style="flex:1">
        <button class="btn" id="torrent-set-dir-btn">Выбрать</button>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="modal-field"><label>Порт прослушивания (для новых)</label><input id="torrent-set-port" type="number" min="1024" max="65535" value="${Number(s.port) || 51413}"></div>
      <div class="modal-field"><label>Максимум пиров (для новых)</label><input id="torrent-set-peers" type="number" min="2" max="500" value="${Number(s.maxPeers) || 60}"></div>
      <div class="modal-field"><label>Слотов отдачи (для новых)</label><input id="torrent-set-slots" type="number" min="0" max="200" value="${Number(s.uploadSlots) || 10}"></div>
      <div class="modal-field"><label>Стоп после рейтинга</label><input id="torrent-set-ratio" type="number" min="0" max="100" step="0.1" value="${Number(s.seedRatio) || 0}"></div>
    </div>
    <label class="setting">
      <div class="setting-text"><div class="setting-title">DHT</div><div class="setting-desc">Поиск пиров без трекеров (BEP 5).</div></div>
      <span class="switch"><input id="torrent-set-dht" type="checkbox" ${s.dht ? 'checked' : ''}><span class="slider"></span></span>
    </label>
    <label class="setting">
      <div class="setting-text"><div class="setting-title">Трекеры</div><div class="setting-desc">Использовать announce-трекеры торрента и список по умолчанию.</div></div>
      <span class="switch"><input id="torrent-set-trackers" type="checkbox" ${s.useTrackers ? 'checked' : ''}><span class="slider"></span></span>
    </label>
    <label class="setting">
      <div class="setting-text"><div class="setting-title">Продолжать при запуске</div><div class="setting-desc">Возобновлять незавершённые загрузки после перезапуска браузера.</div></div>
      <span class="switch"><input id="torrent-set-resume" type="checkbox" ${s.resumeOnStart ? 'checked' : ''}><span class="slider"></span></span>
    </label>
    <label class="setting">
      <div class="setting-text"><div class="setting-title">Добавлять на паузе</div><div class="setting-desc">Новые торренты ждут кнопки «Продолжить».</div></div>
      <span class="switch"><input id="torrent-set-paused" type="checkbox" ${s.startPaused ? 'checked' : ''}><span class="slider"></span></span>
    </label>
    <div class="torrent-modal-actions">
      <button class="btn" id="torrent-set-cancel">Отмена</button>
      <button class="btn primary" id="torrent-set-save">Сохранить</button>
    </div>`);
  $('#torrent-set-cancel', root).addEventListener('click', closeTorrentModal);
  $('#torrent-set-dir-btn', root).addEventListener('click', async () => {
    try {
      const res = await invoke('torrent:choose-dir');
      if (res && res.dir) {
        $('#torrent-set-dir', root).value = res.dir;
        s.dir = res.dir;
      }
    } catch (err) {
      toast(cleanError(err), 'error');
    }
  });
  $('#torrent-set-save', root).addEventListener('click', async () => {
    const number = (selector, min, max, fallback) => {
      const value = Number($(selector, root).value);
      return Math.min(max, Math.max(min, Number.isFinite(value) ? value : fallback));
    };
    const patch = {
      torrentDir: String($('#torrent-set-dir', root).value || '').trim(),
      torrentPort: Math.round(number('#torrent-set-port', 1024, 65535, 51413)),
      torrentMaxPeers: Math.round(number('#torrent-set-peers', 2, 500, 60)),
      torrentUploadSlots: Math.round(number('#torrent-set-slots', 0, 200, 10)),
      torrentSeedRatio: number('#torrent-set-ratio', 0, 100, 0),
      torrentDht: $('#torrent-set-dht', root).checked,
      torrentUseTrackers: $('#torrent-set-trackers', root).checked,
      torrentResumeOnStart: $('#torrent-set-resume', root).checked,
      torrentStartPaused: $('#torrent-set-paused', root).checked,
    };
    try {
      await invoke('settings:set', patch);
      TORRENT.settings = { ...s, ...patch };
      closeTorrentModal();
      await refreshState();
      toast('Настройки BitTorrent сохранены');
      await refreshTorrent();
    } catch (err) {
      toast(cleanError(err), 'error');
    }
  });
}

function openTorrentRemove(id) {
  const job = TORRENT.jobs.find((item) => item.id === id);
  if (!job) return;
  const root = torrentModal(`
    <div class="torrent-modal-title">Удалить загрузку?</div>
    <div class="torrent-modal-sub">${esc(job.name || '')}</div>
    <label class="setting" style="border:0">
      <div class="setting-text"><div class="setting-title">Удалить скачанные файлы</div><div class="setting-desc">Без этой галочки файлы останутся на диске.</div></div>
      <span class="switch"><input id="torrent-remove-data" type="checkbox"><span class="slider"></span></span>
    </label>
    <div class="torrent-modal-actions">
      <button class="btn" id="torrent-remove-cancel">Отмена</button>
      <button class="btn danger" id="torrent-remove-ok">Удалить</button>
    </div>`);
  $('#torrent-remove-cancel', root).addEventListener('click', closeTorrentModal);
  $('#torrent-remove-ok', root).addEventListener('click', async () => {
    try {
      await invoke('torrent:remove', {
        id,
        deleteData: $('#torrent-remove-data', root).checked,
      });
      closeTorrentModal();
      if (TORRENT.selected === id) TORRENT.selected = null;
      toast('Загрузка удалена');
      await refreshTorrent();
    } catch (err) {
      toast(cleanError(err), 'error');
    }
  });
}

async function renderTorrent(body, token) {
  TORRENT.body = body;
  TORRENT.token = token;
  let data;
  try {
    data = await invoke('torrent:list');
  } catch (err) {
    body.innerHTML = `<div class="empty">${esc(cleanError(err))}</div>`;
    return;
  }
  if (token !== S.panelToken) return;
  TORRENT.jobs = data.jobs || [];
  TORRENT.stats = data.stats || {};
  TORRENT.settings = data.settings || {};
  if (!TORRENT.selected || !TORRENT.jobs.some((job) => job.id === TORRENT.selected)) {
    TORRENT.selected = (TORRENT.jobs[0] && TORRENT.jobs[0].id) || null;
  }

  body.innerHTML = `
    <div class="torrent-shell">
      <div class="torrent-top">
        <div class="torrent-stats">
          <div class="torrent-stat"><b id="torrent-stat-down">—</b><span>Скачивание</span></div>
          <div class="torrent-stat"><b id="torrent-stat-up">—</b><span>Отдача</span></div>
          <div class="torrent-stat"><b id="torrent-stat-active">0</b><span>Активных</span></div>
          <div class="torrent-stat"><b id="torrent-stat-total">0</b><span>Всего</span></div>
          <div class="torrent-stat"><b id="torrent-stat-port">—</b><span>Порт</span></div>
        </div>
        <div class="torrent-actions">
          <button class="btn primary" data-torrent-add>${icon('plus')} Добавить</button>
          <button class="btn" data-torrent-file>${icon('folder')} .torrent</button>
          <button class="btn" data-torrent-settings title="Настройки BitTorrent">${icon('settings')}</button>
        </div>
      </div>
      <div class="torrent-toolbar">
        <div class="torrent-filters">
          ${TORRENT_FILTERS.map(([id, label]) => `<button class="torrent-filter${TORRENT.filter === id ? ' active' : ''}" data-torrent-filter="${id}">${label}</button>`).join('')}
        </div>
        <div class="spacer"></div>
        <button class="btn small" id="torrent-pause-all">${icon('pause')} Пауза</button>
      </div>
      <div class="torrent-main">
        <div class="torrent-list">
          <div class="torrent-list-head"><span>Загрузки</span><span id="torrent-list-count"></span></div>
          <div class="torrent-list-body" id="torrent-list-body"></div>
        </div>
        <div class="torrent-details" id="torrent-details"></div>
      </div>
    </div>`;

  $('[data-torrent-add]', body).addEventListener('click', openTorrentAdd);
  $('[data-torrent-file]', body).addEventListener('click', async () => {
    try {
      const res = await invoke('torrent:add-file');
      if (!res || res.canceled) return;
      toast(`Добавлено загрузок: ${(res.ids || []).length}`);
      await refreshTorrent();
    } catch (err) {
      toast(cleanError(err), 'error');
    }
  });
  $('[data-torrent-settings]', body).addEventListener('click', openTorrentSettings);
  $$('[data-torrent-filter]', body).forEach((btn) => {
    btn.addEventListener('click', () => {
      TORRENT.filter = btn.dataset.torrentFilter;
      $$('[data-torrent-filter]', body).forEach((item) => item.classList.toggle('active', item === btn));
      renderTorrentList();
    });
  });
  $('#torrent-pause-all', body).addEventListener('click', async () => {
    const anyActive = TORRENT.jobs.some((job) => !job.paused);
    try {
      await invoke(anyActive ? 'torrent:pause-all' : 'torrent:resume-all');
      await refreshTorrent();
    } catch (err) {
      toast(cleanError(err), 'error');
    }
  });

  renderTorrentList();
  await renderTorrentDetails();
  startTorrentTimer();
}

/* ------------------------------------------------------------------ плеер */
const PLAYER = {
  current: null,
  tracks: [],
  audio: null,
  page: { active: false },
  shuffle: localStorage.getItem('arch.player.shuffle') === '1',
  repeat: ['off', 'all', 'track'].includes(localStorage.getItem('arch.player.repeat'))
    ? localStorage.getItem('arch.player.repeat')
    : 'off',
  closed: false,
  volume: Math.min(1, Math.max(0, Number(localStorage.getItem('arch.player.volume'))) || 1),
  muted: localStorage.getItem('arch.player.muted') === '1',
  total: 0,
  allTotal: 0,
  size: 0,
  limit: 200,
  filter: '',
  scan: null,
  body: null,
  token: 0,
  bound: false,
  filterTimer: null,
  get element() {
    if (!this.audio) this.audio = $('#player-audio');
    return this.audio;
  },
};

function playerFileUrl(track) {
  const raw = String(track.path || '').replace(/\\/g, '/');
  if (!raw) return '';
  // encodeURI оставляет «:» диска и «/», но кодирует пробелы и кириллицу.
  // encodeURIComponent здесь нельзя: «C:» превращался в «C%3A» и файл не открывался.
  const encoded = encodeURI(raw).replace(/#/g, '%23').replace(/\?/g, '%3F');
  return `file:///${encoded.replace(/^\/+/, '')}`;
}

function formatTime(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function playerBindAudio() {
  if (PLAYER.bound) return;
  const el = PLAYER.element;
  if (!el) return;
  PLAYER.bound = true;
  el.volume = PLAYER.volume;
  el.muted = PLAYER.muted;
  el.addEventListener('timeupdate', () => {
    updateMediaBar();
    updatePlayerPanel();
  });
  el.addEventListener('durationchange', () => {
    updateMediaBar();
    updatePlayerPanel();
  });
  el.addEventListener('play', () => {
    updateMediaBar();
    updatePlayerPanel();
  });
  el.addEventListener('pause', () => {
    updateMediaBar();
    updatePlayerPanel();
  });
  el.addEventListener('volumechange', () => {
    updateMediaBar();
    updatePlayerPanel();
  });
  el.addEventListener('ended', () => playerHandleEnded());
  el.addEventListener('error', () => playerHandleMissing());
}

function playerSaveVolume() {
  localStorage.setItem('arch.player.volume', String(PLAYER.volume));
  localStorage.setItem('arch.player.muted', PLAYER.muted ? '1' : '0');
}

function playerSetVolume(value, muted = PLAYER.muted) {
  PLAYER.volume = Math.min(1, Math.max(0, Number(value) || 0));
  PLAYER.muted = !!muted;
  const el = PLAYER.element;
  if (el) {
    el.volume = PLAYER.volume;
    el.muted = PLAYER.muted;
  }
  playerSaveVolume();
  updateMediaBar();
  updatePlayerPanel();
}

function playerToggleShuffle() {
  PLAYER.shuffle = !PLAYER.shuffle;
  localStorage.setItem('arch.player.shuffle', PLAYER.shuffle ? '1' : '0');
  toast(PLAYER.shuffle ? 'Перемешивание включено' : 'Перемешивание выключено');
  updateMediaBar();
  updatePlayerPanel();
}

function playerToggleRepeat() {
  const order = ['off', 'all', 'track'];
  const index = order.indexOf(PLAYER.repeat);
  playerSetRepeat(order[(index + 1) % order.length]);
}

function playerSetRepeat(mode) {
  if (!['off', 'all', 'track'].includes(mode)) return;
  PLAYER.repeat = mode;
  localStorage.setItem('arch.player.repeat', PLAYER.repeat);
  const label = PLAYER.repeat === 'track' ? 'Повтор трека' : PLAYER.repeat === 'all' ? 'Повтор всего плейлиста' : 'Повтор выключен';
  toast(label);
  updateMediaBar();
  updatePlayerPanel();
}

function playerRepeatMenu(event) {
  event.preventDefault();
  const items = [
    { id: 'off', label: `${PLAYER.repeat === 'off' ? '✓ ' : ''}Повтор выключен` },
    { id: 'all', label: `${PLAYER.repeat === 'all' ? '✓ ' : ''}Повтор всего плейлиста` },
    { id: 'track', label: `${PLAYER.repeat === 'track' ? '✓ ' : ''}Повтор трека` },
  ];
  showNativeMenu(event, items).then((picked) => {
    if (picked) playerSetRepeat(picked);
  }).catch(() => {});
}

function playerRepeatIcon() {
  return PLAYER.repeat === 'track' ? icon('repeat-one') : icon('repeat');
}

function playTrack(track, { remember = true } = {}) {
  const el = PLAYER.element;
  if (!track || !track.path || !el) return;
  PLAYER.current = track;
  PLAYER.closed = false;
  el.src = playerFileUrl(track);
  el.volume = PLAYER.volume;
  el.muted = PLAYER.muted;
  el.play().catch(() => {
    // Файл мог быть удалён — молча убираем его из плейлиста.
    playerHandleMissing();
  });
  if (remember) invoke('player:remember', { id: track.id }).catch(() => {});
  // Системное уведомление о новой композиции (включается в настройках).
  invoke('player:notify-track', {
    title: track.name || 'Новая композиция',
    body: track.folder || 'Локальный плеер',
  }).catch(() => {});
  // Подгружаем теги (artist/title), чтобы мини-плеер показал «Artist - Title».
  invoke('player:metadata', { id: track.id }).then((meta) => {
    if (!meta || !PLAYER.current || PLAYER.current.id !== track.id) return;
    track.artist = meta.artist || '';
    track.title = meta.title || '';
    updateMediaBar();
    updatePlayerPanel();
  }).catch(() => {});
  updateMediaBar();
  updatePlayerPanel();
}

async function playerNext(direction = 1, { wrap = PLAYER.repeat === 'all' } = {}) {
  const el = PLAYER.element;
  if (!PLAYER.current) return;
  try {
    const track = await invoke('player:next', {
      id: PLAYER.current.id,
      shuffle: PLAYER.shuffle,
      direction,
      wrap: !!wrap,
    });
    if (track) {
      playTrack(track);
    } else if (direction > 0) {
      // Конец плейлиста: останавливаемся и прячем пульт.
      if (el) el.pause();
      PLAYER.closed = true;
      updateMediaBar();
      updatePlayerPanel();
    }
  } catch (err) {
    toast(cleanError(err), 'error');
  }
}

function playerHandleEnded() {
  const el = PLAYER.element;
  if (!PLAYER.current) return;
  if (PLAYER.repeat === 'track') {
    if (el) {
      el.currentTime = 0;
      el.play().catch(() => playerHandleMissing());
    }
    updateMediaBar();
    updatePlayerPanel();
    return;
  }
  playerNext(1);
}

async function playerPrev() {
  const el = PLAYER.element;
  if (PLAYER.current && el && el.currentTime > 3) {
    el.currentTime = 0;
    updateMediaBar();
    return;
  }
  if (!PLAYER.current) {
    // После перезапуска «Назад» возвращает последнюю композицию из истории.
    try {
      const track = await invoke('player:previous', { id: '' });
      if (track) playTrack(track, { remember: false });
    } catch {}
    return;
  }
  try {
    const track = await invoke('player:previous', { id: PLAYER.current.id });
    if (track) {
      // Возврат по истории не должен дописывать трек в её конец — иначе
      // повторное нажатие «Назад» снова приводило бы вперёд.
      playTrack(track, { remember: false });
      return;
    }
  } catch {}
  playerNext(-1, { wrap: false });
}

async function playerRemoveCurrent() {
  const track = PLAYER.current;
  if (!track) return;
  PLAYER.current = null;
  const el = PLAYER.element;
  if (el) {
    try {
      el.pause();
      el.removeAttribute('src');
      el.load();
    } catch {}
  }
  await invoke('player:remove', { id: track.id }).catch(() => {});
  PLAYER.closed = true;
  await refreshPlayerList();
  updateMediaBar();
  updatePlayerPanel();
}

function playerHandleMissing() {
  if (!PLAYER.current) return;
  // Ошибку не показываем: пользователь мог просто удалить файл с диска.
  playerRemoveCurrent().catch(() => {});
}

async function toggleMediaPlayback() {
  const el = PLAYER.element;
  if (PLAYER.current && el) {
    PLAYER.closed = false;
    if (el.paused) el.play().catch(() => playerHandleMissing());
    else el.pause();
    updateMediaBar();
    updatePlayerPanel();
    return;
  }
  // Ничего не выбрано: запускаем первую композицию, а при перемешивании —
  // случайную.
  try {
    const track = await invoke('player:start', { shuffle: PLAYER.shuffle });
    if (track) {
      playTrack(track);
      return;
    }
  } catch {}
  const page = (S.data && S.data.player && S.data.player.page) || {};
  invoke('player:control', { action: page.playing ? 'pause' : 'play' })
    .catch((err) => toast(cleanError(err), 'error'));
}

/* Панель пульта в панели инструментов: локальный файл или медиа на странице. */
function notifyMediaBarVisibility(visible) {
  const next = !!visible;
  if (S.mediaBarVisible === next) return;
  S.mediaBarVisible = next;
  invoke('ui:media-bar', { visible: next }).catch(() => {});
}

// Формат отображения в мини-плеере: «Artist - Title». Если оба тега пустые —
// название файла без расширения; пустой artist → «Неизвестный»; пустой title →
// название файла без расширения.
function mediaTrackLabel(artist, title, filename) {
  const a = String(artist || '').trim();
  const t = String(title || '').trim();
  const f = String(filename || '').trim();
  if (!a && !t) return f || 'Медиа на странице';
  return `${a || 'Неизвестный'} - ${t || f || 'Медиа на странице'}`;
}

function stripExt(name) {
  return String(name || '').replace(/\.[^.]+$/, '');
}

function updateMediaBar() {
  const bar = $('#media-bar');
  if (!bar) return;
  const el = PLAYER.element;
  const local = !!PLAYER.current && !PLAYER.closed;
  const page = (S.data && S.data.player && S.data.player.page) || {};
  const usePage = !local && !PLAYER.closed && page.active;
  if (!local && !usePage) {
    bar.classList.add('hidden');
    notifyMediaBarVisibility(false);
    if (S.sendLayout) S.sendLayout();
    return;
  }
  bar.classList.remove('hidden');
  notifyMediaBarVisibility(true);
  const artist = local ? (PLAYER.current.artist || '') : (page.artist || '');
  const trackTitle = local ? (PLAYER.current.title || '') : (page.title || '');
  const filename = local ? stripExt(PLAYER.current.name) : '';
  const playing = local ? !!(el && !el.paused) : !!page.playing;
  const position = local ? (el ? el.currentTime : 0) : (page.position || 0);
  const duration = local ? (el ? el.duration : 0) : (page.duration || 0);
  const titleEl = $('#media-bar-title');
  const titleText = mediaTrackLabel(artist, trackTitle, filename);
  if (titleEl.textContent !== titleText) titleEl.textContent = titleText;
  const timeText = duration
    ? `${formatTime(position)} / ${formatTime(duration)}`
    : formatTime(position);
  const timeEl = $('#media-bar-time');
  if (timeEl.textContent !== timeText) timeEl.textContent = timeText;
  setIcon($('#media-bar-toggle'), playing ? 'pause' : 'play');
  const seek = $('#media-bar-seek');
  seek.value = duration ? String(Math.min(1, position / duration)) : '0';
  seek.disabled = !duration;
  $('#media-bar-toggle').dataset.mode = local ? 'local' : 'page';
  $('#media-bar-prev').disabled = !local && !page.active;
  $('#media-bar-next').disabled = !local && !page.active;
  const repeat = $('#media-bar-repeat');
  if (repeat) {
    setIcon(repeat, PLAYER.repeat === 'track' ? 'repeat-one' : 'repeat');
    repeat.classList.toggle('active', PLAYER.repeat !== 'off');
    const label = PLAYER.repeat === 'track'
      ? 'Повтор трека'
      : PLAYER.repeat === 'all'
        ? 'Повтор всего плейлиста'
        : 'Повтор выключен';
    if (repeat.title !== label) repeat.title = label;
  }
  $('#media-bar-shuffle').classList.toggle('active', !!PLAYER.shuffle);
  $('#media-bar-volume-wrap').classList.toggle('hidden', !local);
  $('#media-bar-volume').value = String(PLAYER.volume);
  setIcon($('#media-bar-mute'), PLAYER.muted || PLAYER.volume === 0 ? 'volume-off' : 'volume');
  if (S.sendLayout) S.sendLayout();
}

function playerPageBlock(page) {
  if (!page || !page.active) return '';
  return `
    <div class="card">
      <div class="list-row">
        <div class="ext-icon">${icon('film')}</div>
        <div class="list-main">
          <div class="list-title">${esc(page.title || 'Воспроизведение на странице')}</div>
          <div class="list-sub">${page.playing ? 'Играет' : 'На паузе'}${page.duration ? ` · ${formatTime(page.duration)}` : ''}</div>
        </div>
        <div class="setting-control" style="display:flex;gap:4px">
          <button class="icon-btn" data-page-media="prev" title="Предыдущий">${icon('prev')}</button>
          <button class="icon-btn" data-page-media="${page.playing ? 'pause' : 'play'}" title="${page.playing ? 'Пауза' : 'Играть'}">${icon(page.playing ? 'pause' : 'play')}</button>
          <button class="icon-btn" data-page-media="next" title="Следующий">${icon('next')}</button>
        </div>
      </div>
    </div>`;
}

function playerNowMarkup() {
  return `
    <div class="player-now" id="player-now">
      <div class="player-art">${icon('music')}</div>
      <div class="player-now-main">
        <div class="player-now-title" id="player-now-title">Ничего не играет</div>
        <div class="player-now-sub" id="player-now-sub">Добавьте музыку или папку с компьютера</div>
        <input class="player-seek" id="player-now-seek" type="range" min="0" max="1" step="0.001" value="0" disabled>
        <div class="player-time">
          <span id="player-now-time">0:00</span>
          <span id="player-now-duration">0:00</span>
        </div>
      </div>
      <div class="player-controls">
        <button class="icon-btn" id="player-shuffle" title="Перемешивание">${icon('shuffle')}</button>
        <button class="icon-btn" id="player-repeat" title="Повтор">${playerRepeatIcon()}</button>
        <button class="icon-btn" id="player-prev" title="Предыдущий">${icon('prev')}</button>
        <button class="icon-btn primary" id="player-play" title="Играть / пауза">${icon('play')}</button>
        <button class="icon-btn" id="player-next" title="Следующий">${icon('next')}</button>
        <div class="player-volume-wrap">
          <button class="icon-btn" id="player-mute" title="Звук">${icon('volume')}</button>
          <input class="player-volume" id="player-volume" type="range" min="0" max="1" step="0.01" value="${PLAYER.volume}" title="Громкость">
        </div>
      </div>
    </div>`;
}

function playerRowsHtml(tracks) {
  if (!tracks.length) {
    return `<div class="empty">${PLAYER.filter ? 'Ничего не найдено.' : 'Плейлист пуст. Добавьте аудиофайлы или целую папку — они будут играть прямо в браузере.'}</div>`;
  }
  return tracks.map((track) => {
    const active = PLAYER.current && PLAYER.current.id === track.id;
    const playing = active && PLAYER.element && !PLAYER.element.paused;
    return `
      <div class="list-row player-row${active ? ' active' : ''}${playing ? ' playing' : ''}" data-track-id="${esc(track.id)}">
        <div class="list-main">
          <div class="list-title">${playing ? '<span class="player-eq"></span>' : ''}${esc(track.name)}</div>
          <div class="list-sub">${esc(track.folder ? `${track.folder} · ${track.path}` : track.path)}</div>
        </div>
        <button class="icon-btn danger" data-track-remove="${esc(track.id)}" title="Убрать из плейлиста">${icon('trash')}</button>
      </div>`;
  }).join('');
}

function playerBindList(container) {
  $$('[data-track-id]', container).forEach((row) => {
    row.addEventListener('click', (event) => {
      if (event.target.closest('[data-track-remove]')) return;
      const track = PLAYER.tracks.find((item) => item.id === row.dataset.trackId);
      if (track) playTrack(track);
    });
  });
  $$('[data-track-remove]', container).forEach((btn) => {
    btn.addEventListener('click', async (event) => {
      event.stopPropagation();
      const id = btn.dataset.trackRemove;
      await invoke('player:remove', { id });
      if (PLAYER.current && PLAYER.current.id === id) {
        const el = PLAYER.element;
        if (el) {
          el.pause();
          el.removeAttribute('src');
          try { el.load(); } catch {}
        }
        PLAYER.current = null;
      }
      await refreshPlayerList();
      updateMediaBar();
      updatePlayerPanel();
    });
  });
}

async function playerFetchPage() {
  const data = await invoke('player:list', {
    query: PLAYER.filter,
    offset: 0,
    limit: PLAYER.limit,
  });
  PLAYER.tracks = data.tracks || [];
  PLAYER.total = Number(data.total) || 0;
  PLAYER.allTotal = Number(data.allTotal) || 0;
  PLAYER.size = Number(data.size) || 0;
  PLAYER.page = data.page || { active: false };
  return data;
}

function playerUpdateCounts() {
  const label = $('#player-total-label');
  if (label) {
    label.textContent = `${plural(PLAYER.allTotal, 'файл', 'файла', 'файлов')} · ${fmtBytes(PLAYER.size)}`;
  }
  const shown = $('#player-shown-label');
  if (shown) {
    shown.textContent = PLAYER.total > PLAYER.tracks.length
      ? `Показано ${PLAYER.tracks.length} из ${PLAYER.total}`
      : plural(PLAYER.total, 'совпадение', 'совпадения', 'совпадений');
  }
  const more = $('#player-more');
  if (more) more.classList.toggle('hidden', PLAYER.tracks.length >= PLAYER.total);
}

async function refreshPlayerList() {
  if (!PLAYER.body || !PLAYER.body.isConnected || S.mode !== 'player') return;
  try {
    await playerFetchPage();
  } catch (err) {
    toast(cleanError(err), 'error');
    return;
  }
  const card = $('#player-list-card', PLAYER.body);
  if (card) {
    card.innerHTML = playerRowsHtml(PLAYER.tracks);
    playerBindList(card);
  }
  playerUpdateCounts();
}

function updatePlayerScan() {
  const box = $('#player-scan');
  if (!box) return;
  const scan = PLAYER.scan;
  if (!scan || scan.phase === 'done') {
    box.classList.add('hidden');
    return;
  }
  box.classList.remove('hidden');
  const label = $('#player-scan-text');
  if (label) {
    const added = Number(scan.added) || 0;
    if (scan.phase === 'size') {
      label.textContent = `Читаем размеры файлов… ${Number(scan.sized) || 0} из ${added}`;
    } else {
      const scanned = Number(scan.scanned) || 0;
      label.textContent = `Сканируем папки… ${plural(scanned, 'объект', 'объекта', 'объектов')}, найдено ${added}`;
    }
  }
}

function updatePlayerPanel() {
  if (!PLAYER.body || !PLAYER.body.isConnected || S.mode !== 'player') return;
  const el = PLAYER.element;
  const current = PLAYER.current;
  const title = $('#player-now-title', PLAYER.body);
  if (!title) return;
  title.textContent = current ? current.name : 'Ничего не играет';
  const sub = $('#player-now-sub', PLAYER.body);
  if (sub) sub.textContent = current ? (current.folder ? `${current.folder} · ${current.path}` : current.path) : 'Добавьте музыку или папку с компьютера';
  const duration = current && el ? (el.duration || 0) : 0;
  const position = current && el ? (el.currentTime || 0) : 0;
  const seek = $('#player-now-seek', PLAYER.body);
  if (seek) {
    seek.value = duration ? String(Math.min(1, position / duration)) : '0';
    seek.disabled = !duration;
  }
  const time = $('#player-now-time', PLAYER.body);
  if (time) time.textContent = formatTime(position);
  const dur = $('#player-now-duration', PLAYER.body);
  if (dur) dur.textContent = formatTime(duration);
  const play = $('#player-play', PLAYER.body);
  if (play) setIcon(play, current && el && !el.paused ? 'pause' : 'play');
  const shuffle = $('#player-shuffle', PLAYER.body);
  if (shuffle) shuffle.classList.toggle('active', !!PLAYER.shuffle);
  const repeat = $('#player-repeat', PLAYER.body);
  if (repeat) {
    setIcon(repeat, PLAYER.repeat === 'track' ? 'repeat-one' : 'repeat');
    repeat.classList.toggle('active', PLAYER.repeat !== 'off');
    const label = PLAYER.repeat === 'track'
      ? 'Повтор трека'
      : PLAYER.repeat === 'all'
        ? 'Повтор всего плейлиста'
        : 'Повтор выключен';
    if (repeat.title !== label) repeat.title = label;
  }
  const volume = $('#player-volume', PLAYER.body);
  if (volume) volume.value = String(PLAYER.volume);
  const mute = $('#player-mute', PLAYER.body);
  if (mute) setIcon(mute, PLAYER.muted || PLAYER.volume === 0 ? 'volume-off' : 'volume');
  $$('.player-row', PLAYER.body).forEach((row) => {
    const active = !!(current && row.dataset.trackId === current.id);
    row.classList.toggle('active', active);
    row.classList.toggle('playing', active && !!(el && !el.paused));
    const titleEl = $('.list-title', row);
    if (!titleEl) return;
    const eq = $('.player-eq', titleEl);
    if (active && !(el && el.paused) && !eq) titleEl.insertAdjacentHTML('afterbegin', '<span class="player-eq"></span>');
    else if ((!active || (el && el.paused)) && eq) eq.remove();
  });
}

async function renderPlayer(body, token) {
  playerBindAudio();
  PLAYER.body = body;
  PLAYER.token = token;
  let data;
  try {
    data = await playerFetchPage();
  } catch (err) {
    body.innerHTML = `<div class="empty">${esc(cleanError(err))}</div>`;
    return;
  }
  if (token !== S.panelToken) return;

  const page = data.page || {};
  const pageBlock = playerPageBlock(page);
  body.innerHTML = `
    <div class="toolbar-line">
      <span id="player-total-label" style="color:var(--muted);font-size:12px">${plural(PLAYER.allTotal, 'файл', 'файла', 'файлов')} · ${fmtBytes(PLAYER.size)}</span>
      <div class="spacer"></div>
      <button class="btn" data-player-add>${icon('plus')} Добавить файлы</button>
      <button class="btn" data-player-folder>${icon('folder-plus')} Добавить папку</button>
      ${PLAYER.allTotal ? `<button class="btn" data-player-clear>${icon('trash')} Очистить</button>` : ''}
    </div>
    <div class="player-scan hidden" id="player-scan">
      <span id="player-scan-text">Сканируем…</span>
      <div class="mini-track"><div class="mini-fill" style="width:100%;animation:pulse 1.2s ease-in-out infinite"></div></div>
    </div>
    ${pageBlock}
    ${playerNowMarkup()}
    <div class="player-filter-row">
      <input class="player-filter" id="player-filter" type="search" placeholder="Поиск по названию, папке или пути" value="${esc(PLAYER.filter)}">
      <span id="player-shown-label" style="font-size:11px;color:var(--muted)"></span>
      <button class="btn hidden" id="player-more">Показать ещё</button>
    </div>
    <div class="card player-list" id="player-list-card">${playerRowsHtml(PLAYER.tracks)}</div>
  `;
  playerBindList($('#player-list-card', body));
  playerUpdateCounts();
  updatePlayerScan();
  updatePlayerPanel();

  $('[data-player-add]', body)?.addEventListener('click', async () => {
    try {
      const res = await invoke('player:add');
      if (!res || res.canceled) return;
      toast(`Добавлено файлов: ${res.addedCount || 0}`);
      await refreshPlayerList();
      updatePlayerPanel();
    } catch (err) {
      toast(cleanError(err), 'error');
    }
  });
  $('[data-player-folder]', body)?.addEventListener('click', async () => {
    try {
      PLAYER.scan = { phase: 'scan', scanned: 0, added: 0 };
      updatePlayerScan();
      const res = await invoke('player:add-folder');
      PLAYER.scan = null;
      if (!res || res.canceled) {
        updatePlayerScan();
        return;
      }
      toast(`Добавлено файлов: ${res.addedCount || 0}`);
      await refreshPlayerList();
      updatePlayerPanel();
      updatePlayerScan();
    } catch (err) {
      PLAYER.scan = null;
      updatePlayerScan();
      toast(cleanError(err), 'error');
    }
  });
  $('[data-player-clear]', body)?.addEventListener('click', async () => {
    await invoke('player:clear');
    PLAYER.current = null;
    const el = PLAYER.element;
    if (el) {
      el.pause();
      el.removeAttribute('src');
      try { el.load(); } catch {}
    }
    await refreshPlayerList();
    updateMediaBar();
    updatePlayerPanel();
  });
  $('#player-filter', body).addEventListener('input', (event) => {
    PLAYER.filter = event.target.value;
    clearTimeout(PLAYER.filterTimer);
    PLAYER.filterTimer = setTimeout(() => {
      PLAYER.limit = 200;
      refreshPlayerList();
    }, 180);
  });
  $('#player-more', body).addEventListener('click', () => {
    PLAYER.limit += 200;
    refreshPlayerList();
  });
  $('#player-shuffle', body).addEventListener('click', playerToggleShuffle);
  $('#player-repeat', body).addEventListener('click', playerToggleRepeat);
  $('#player-repeat', body).addEventListener('contextmenu', playerRepeatMenu);
  $('#player-prev', body).addEventListener('click', playerPrev);
  $('#player-play', body).addEventListener('click', toggleMediaPlayback);
  $('#player-next', body).addEventListener('click', () => playerNext(1));
  $('#player-mute', body).addEventListener('click', () => playerSetVolume(PLAYER.volume, !PLAYER.muted));
  $('#player-volume', body).addEventListener('input', (event) => playerSetVolume(Number(event.target.value), false));
  $('#player-now-seek', body).addEventListener('input', (event) => {
    const el = PLAYER.element;
    if (!PLAYER.current || !el || !el.duration) return;
    el.currentTime = (Number(event.target.value) || 0) * el.duration;
    updateMediaBar();
    updatePlayerPanel();
  });
  $$('[data-page-media]', body).forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await invoke('player:control', { action: btn.dataset.pageMedia });
      } catch (err) {
        toast(cleanError(err), 'error');
      }
    });
  });
}

/* ------------------------------------------------------------------ панель закладок */
let bookmarkBarBound = false;
let bookmarkBarObserver = null;
let bookmarkBarSignature = '';
let bookmarkBarLastTree = { folders: [], bookmarks: [] };
let bookmarkBarHovered = false;
let bookmarkBarPending = false;
let faviconCache = null;

// Иконка закладки: favicon сайта, если он известен, иначе значок закладки.
function bookmarkIcon(url) {
  try {
    const host = new URL(url).hostname;
    const src = faviconCache ? faviconCache[host] : '';
    if (src) return `<img class="bb-favicon" src="${esc(src)}" alt="" loading="lazy">`;
  } catch {}
  return icon('bookmark');
}

// Кнопка «…» появляется только если закладки не помещаются в панель.
// Место под неё зарезервировано всегда (см. CSS), поэтому ширина списка не
// прыгает при появлении кнопки — иначе подсказки мигали, а часть закладок
// «переезжала» между видимыми и скрытыми.
function updateBookmarkOverflow() {
  const bar = $('#bookmarks-bar');
  if (!bar) return;
  const list = $('.bb-list', bar);
  const more = $('.bb-more', bar);
  if (!list || !more) return;
  const overflow = list.scrollWidth > list.clientWidth + 2;
  more.classList.toggle('hidden', !overflow);
  const listRect = list.getBoundingClientRect();
  bar._overflowEls = [...list.children].filter((el) => {
    if (!el.classList.contains('bb-item') && !el.classList.contains('bb-folder')) return false;
    return el.getBoundingClientRect().right > listRect.right + 1;
  });
}

// Пункты нативного меню для папки закладок (с вложенными папками).
function bookmarkMenuItems(folder) {
  const items = (folder.bookmarks || []).map((b) => ({
    id: `open:${b.url}`,
    label: b.title || b.url,
  }));
  for (const child of folder.children || []) {
    if (!child) continue;
    const submenu = bookmarkMenuItems(child);
    items.push({
      label: child.name || 'Папка',
      submenu: submenu.length ? submenu : [{ label: 'Папка пуста', enabled: false }],
    });
  }
  return items;
}

function folderById(id) {
  const tree = bookmarkBarLastTree || { folders: [] };
  return (tree.folders || []).find((f) => f.id === id) || null;
}

async function renderBookmarksBar(force = false) {
  const bar = $('#bookmarks-bar');
  if (!bar) return;
  const enabled = !!(S.data && S.data.settings && S.data.settings.showBookmarksBar);
  bar.classList.toggle('hidden', !enabled);
  if (!enabled) {
    bookmarkBarHovered = false;
    bookmarkBarPending = false;
    return;
  }
  if (!faviconCache) {
    try { faviconCache = await invoke('favicons:get') || {}; } catch { faviconCache = {}; }
  }
  let tree = { folders: [], bookmarks: [] };
  try {
    tree = await invoke('bookmarks:tree');
  } catch {
    return;
  }
  const signature = JSON.stringify(tree);
  if (!force && signature === bookmarkBarSignature && bar.dataset.ready === '1') {
    // Тот же набор закладок: не пересобираем DOM. Раньше панель
    // перерисовывалась на каждом обновлении состояния, из-за чего
    // подсказки мигали, а клики иногда терялись между mousedown и click.
    updateBookmarkOverflow();
    return;
  }
  if (!force && bookmarkBarHovered && bar.matches(':hover') && bar.dataset.ready === '1') {
    // Пока курсор над панелью (и, возможно, показана системная подсказка),
    // не трогаем DOM — иначе подсказка мигает и пропадает.
    bookmarkBarPending = true;
    return;
  }
  bookmarkBarPending = false;
  bookmarkBarSignature = signature;
  bookmarkBarLastTree = tree;
  bar.dataset.ready = '1';

  const folderHtml = (folder) => `
    <span class="bb-folder" data-bb-folder="${esc(folder.id)}">
      <span class="bb-item">${icon('folder')}<span>${esc(folder.name)}</span></span>
    </span>`;

  bar.innerHTML = `
    <div class="bb-list">
      ${tree.folders.map(folderHtml).join('')}
      ${tree.bookmarks.map((b) => `
        <span class="bb-item" data-bb-url="${esc(b.url)}" data-bb-id="${esc(b.id)}" title="${esc(b.url)}">
          ${bookmarkIcon(b.url)}<span>${esc(b.title || b.url)}</span>
        </span>`).join('')}
      ${tree.folders.length || tree.bookmarks.length ? '' : '<span class="bb-empty-bar">Закладок пока нет</span>'}
    </div>
    <button class="bb-more hidden" title="Ещё закладки">${icon('menu')}</button>
  `;

  const navigate = async (url) => {
    await invoke('tabs:navigate', { url });
    setPanel('web');
  };

  $$('[data-bb-url]', bar).forEach((entry) => {
    entry.addEventListener('click', () => navigate(entry.dataset.bbUrl));
    entry.addEventListener('contextmenu', async (event) => {
      event.preventDefault();
      const id = entry.dataset.bbId;
      const b = id ? findBookmarkById(id) : null;
      const items = [
        { id: 'open', label: 'Открыть' },
        { id: 'new', label: 'Открыть в новой вкладке' },
        { type: 'separator' },
      ];
      if (b) {
        items.push({ id: 'edit', label: 'Редактировать…' });
        items.push({ id: 'remove', label: 'Удалить' });
        items.push({ type: 'separator' });
      }
      items.push({ id: 'copy', label: 'Копировать адрес' });
      const picked = await showNativeMenu(event, items);
      if (!picked) return;
      if (picked === 'open') await navigate(entry.dataset.bbUrl);
      else if (picked === 'new') invoke('tabs:create', { url: entry.dataset.bbUrl }).catch(() => {});
      else if (picked === 'edit' && b) await editBookmark(b.id);
      else if (picked === 'remove' && b) {
        await invoke('bookmarks:remove', { id: b.id });
        await refreshState();
      } else if (picked === 'copy') {
        invoke('clipboard:write-text', { text: entry.dataset.bbUrl }).catch(() => {});
      }
    });
  });
  $$('[data-bb-folder]', bar).forEach((folder) => {
    folder.addEventListener('click', async (event) => {
      if (event.target.closest('[data-bb-url]')) return;
      event.stopPropagation();
      const data = folderById(folder.dataset.bbFolder);
      if (!data) return;
      const items = bookmarkMenuItems(data);
      if (!items.length) items.push({ label: 'Папка пуста', enabled: false });
      const picked = await showNativeMenu(event, items);
      if (picked && picked.startsWith('open:')) await navigate(picked.slice(5));
    });
  });
  // Кнопка переполнения: меню со всеми папками и закладками.
  const more = $('.bb-more', bar);
  if (more) {
    more.addEventListener('click', async (event) => {
      event.stopPropagation();
      const items = [{ id: 'panel', label: 'Все закладки' }];
      const hiddenEls = Array.isArray(bar._overflowEls) ? bar._overflowEls : [];
      if (hiddenEls.length) {
        items.push({ type: 'separator' });
        for (const el of hiddenEls) {
          if (el.dataset.bbFolder) {
            const folder = folderById(el.dataset.bbFolder);
            if (!folder) continue;
            const submenu = bookmarkMenuItems(folder);
            items.push({
              label: folder.name || 'Папка',
              submenu: submenu.length ? submenu : [{ label: 'Папка пуста', enabled: false }],
            });
          } else if (el.dataset.bbUrl) {
            const label = (el.textContent || '').trim() || el.dataset.bbUrl;
            items.push({ id: `open:${el.dataset.bbUrl}`, label });
          }
        }
      } else {
        // Резервный вариант: измерение не удалось — показываем всё.
        if (tree.folders.length) {
          items.push({ type: 'separator' });
          for (const folder of tree.folders) {
            const submenu = bookmarkMenuItems(folder);
            items.push({
              label: folder.name || 'Папка',
              submenu: submenu.length ? submenu : [{ label: 'Папка пуста', enabled: false }],
            });
          }
        }
        if (tree.bookmarks.length) {
          items.push({ type: 'separator' });
          for (const b of tree.bookmarks) items.push({ id: `open:${b.url}`, label: b.title || b.url });
        }
      }
      if (items.length === 1) items.push({ label: 'Закладок пока нет', enabled: false });
      const picked = await showNativeMenu(event, items);
      if (!picked) return;
      if (picked === 'panel') setPanel('bookmarks');
      else if (picked.startsWith('open:')) await navigate(picked.slice(5));
    });
  }
  requestAnimationFrame(updateBookmarkOverflow);
  if (!bookmarkBarBound) {
    bookmarkBarBound = true;
    bar.addEventListener('pointerenter', () => { bookmarkBarHovered = true; });
    bar.addEventListener('pointerleave', () => {
      bookmarkBarHovered = false;
      if (bookmarkBarPending) {
        bookmarkBarPending = false;
        renderBookmarksBar(true);
      }
    });
    // Если favicon не загрузился — заменяем его значком закладки.
    bar.addEventListener('error', (event) => {
      const img = event.target;
      if (img && img.classList && img.classList.contains('bb-favicon')) {
        img.outerHTML = icon('bookmark');
      }
    }, true);
    window.addEventListener('resize', () => {
      updateBookmarkOverflow();
    });
    if (window.ResizeObserver) {
      bookmarkBarObserver = new ResizeObserver(() => updateBookmarkOverflow());
      bookmarkBarObserver.observe(bar);
    }
  }
}

function findBookmarkById(id) {
  const tree = bookmarkBarLastTree || { folders: [], bookmarks: [] };
  const all = [...tree.bookmarks];
  for (const folder of tree.folders) all.push(...(folder.bookmarks || []));
  return all.find((b) => b.id === id) || null;
}

/* ------------------------------------------------------------------ downloads */
function renderDownloads(body) {
  const items = S.data.downloads || [];
  if (!items.length) {
    body.innerHTML = renderEmpty('download', 'Нет загрузок', 'Файлы, скачанные из браузера, появятся здесь.');
    return;
  }

  body.innerHTML = `
    <div class="toolbar-line">
      <span style="color:#8a99ae;font-size:12px">${items.length} файлов</span>
      <div class="spacer"></div>
      <button class="btn" data-downloads="clear">${icon('trash')} Очистить завершённые</button>
    </div>
    <div class="card">
      ${items.map((d) => {
        const done = d.state === 'completed';
        const failed = d.state === 'interrupted' || d.state === 'cancelled';
        const progress = d.total ? Math.min(100, Math.round((d.received / d.total) * 100)) : done ? 100 : 3;
        return `<div class="list-row" style="align-items:flex-start">
          <div class="ext-icon" style="margin-top:2px">${icon('download')}</div>
          <div class="list-main">
            <div class="list-title">${esc(d.filename)}</div>
            <div class="list-sub">${esc(d.url)}</div>
            <div class="download-progress ${done ? 'done' : failed ? 'fail' : ''}"><div style="width:${progress}%"></div></div>
            <div class="download-state ${done ? 'done' : failed ? 'fail' : ''}" style="margin-top:5px">
              ${done ? 'Завершено' : failed ? 'Прервано' : d.paused ? 'Пауза' : `Загрузка · ${fmtBytes(d.received)} из ${fmtBytes(d.total)}${d.speed ? ' · ' + fmtBytes(d.speed) + '/с' : ''}`}
            </div>
          </div>
          <div class="server-actions">
            ${done ? `
              <button class="icon-btn" data-open="${esc(d.id)}" title="Открыть">${icon('external')}</button>
              <button class="icon-btn" data-show="${esc(d.id)}" title="Показать в папке">${icon('folder')}</button>
            ` : failed ? `
              <button class="icon-btn" data-show="${esc(d.id)}" title="Показать в папке">${icon('folder')}</button>
            ` : `
              <button class="icon-btn" data-pause="${esc(d.id)}" title="${d.paused ? 'Продолжить' : 'Пауза'}">${icon(d.paused ? 'play' : 'pause')}</button>
              <button class="icon-btn" data-cancel="${esc(d.id)}" title="Отменить">${icon('close')}</button>
            `}
          </div>
        </div>`;
      }).join('')}
    </div>
  `;

  $$('[data-open]', body).forEach((btn) => {
    btn.addEventListener('click', () => invoke('downloads:open', { id: btn.dataset.open }).catch((e) => toast(cleanError(e), 'error')));
  });
  $$('[data-show]', body).forEach((btn) => {
    btn.addEventListener('click', () => invoke('downloads:show', { id: btn.dataset.show }).catch(() => {}));
  });
  $$('[data-pause]', body).forEach((btn) => {
    btn.addEventListener('click', async () => {
      const rec = items.find((d) => d.id === btn.dataset.pause);
      await invoke(rec && rec.paused ? 'downloads:resume' : 'downloads:pause', { id: btn.dataset.pause }).catch(() => {});
      await refreshState();
      if (S.mode === 'downloads') renderPanel('downloads');
    });
  });
  $$('[data-cancel]', body).forEach((btn) => {
    btn.addEventListener('click', async () => {
      await invoke('downloads:cancel', { id: btn.dataset.cancel }).catch(() => {});
      await refreshState();
      if (S.mode === 'downloads') renderPanel('downloads');
    });
  });
  $('[data-downloads="clear"]', body).addEventListener('click', async () => {
    await invoke('downloads:clear');
    await refreshState();
    if (S.mode === 'downloads') renderPanel('downloads');
  });
}

/* ------------------------------------------------------------------ about */
function renderAbout(body) {
  const v = S.data.version;
  body.innerHTML = `
    <div class="about-hero">
      <div class="about-logo"><img src="../../assets/icon.png" alt="ArchBrowser"></div>
      <div>
        <div class="about-title">ArchBrowser</div>
        <div class="about-sub">Приватный браузер на Chromium · без телеметрии и слежки</div>
      </div>
    </div>
    <div class="card">
      <div class="kv"><span>Версия ArchBrowser</span><span>${esc(v.app)}</span></div>
      <div class="kv"><span>Движок Chromium</span><span>${esc(v.chrome)}</span></div>
      <div class="kv"><span>Electron</span><span>${esc(v.electron)}</span></div>
      <div class="kv"><span>Блок-лист</span><span>${Number(S.data.privacyStats.blocklistSize || 0).toLocaleString('ru-RU')} доменов</span></div>
      <div class="kv"><span>VPN (Xray)</span><span>${S.data.vpn.coreAvailable ? 'готов к работе' : 'не найден'}</span></div>
      <div class="kv"><span>Расширения</span><span>${(S.data.extensions || []).length} загружено</span></div>
    </div>
    <div class="section-label">Что внутри</div>
    <div class="card">
      ${[
        ['shield', 'Сетевой щит', 'Блокировка рекламы и трекеров по доменным спискам, вырезание сторонних cookies.'],
        ['eye-off', 'Антифингерпринтинг', 'Шум canvas/WebGL/audio, скрытие webdriver, защита от утечек WebRTC.'],
        ['lock', 'HTTPS и DoH', 'Принудительный HTTPS и шифрованный DNS (выбирается в настройках).'],
        ['globe', 'VPN на Xray', 'VLESS/Reality, VMess, Trojan, Shadowsocks и подписки — как в v2raytun.'],
        ['telegram', 'Telegram Desktop Помощник', 'Встроенная боковая панель с сохранением входа и счётчиком непрочитанных.'],
        ['puzzle', 'Расширения Chromium', 'Распакованные расширения Manifest V2/V3. uBlock Origin уже включён.'],
      ].map(([ic, title, desc]) => `<div class="setting"><div class="setting-text"><div class="setting-title">${icon(ic)} ${title}</div><div class="setting-desc">${desc}</div></div></div>`).join('')}
    </div>
    <div class="btn-row">
      <button class="btn" data-about="check">${icon('external')} Проверить защиту (EFF)</button>
      <button class="btn" data-about="extensions">${icon('folder')} Папка расширений</button>
      <button class="btn" data-about="settings">${icon('settings')} Настройки</button>
    </div>
  `;

  $('[data-about="check"]', body).addEventListener('click', async () => {
    await invoke('tabs:create', { url: 'https://coveryourtracks.eff.org/' });
    setPanel('web');
  });
  $('[data-about="extensions"]', body).addEventListener('click', () => invoke('extensions:open-folder'));
  $('[data-about="settings"]', body).addEventListener('click', () => invoke('settings:open-tab').catch(() => {}));
}

/* ------------------------------------------------------------------ suggestions */
function suggestionHtml(query) {
  // Разметка строк — оформление применяется в окне подсказок.
  let html = '';
  html += `<div class="suggest-row ${S.selected === -1 ? 'selected' : ''}" data-suggest="-1">
    ${icon('search')}
    <div class="suggest-main"><div class="suggest-title">Искать «${esc(query)}»</div></div>
    <span class="suggest-action">Поиск</span>
  </div>`;
  S.suggestions.forEach((item, index) => {
    html += `<div class="suggest-row ${S.selected === index ? 'selected' : ''}" data-suggest="${index}">
      ${icon('history')}
      <div class="suggest-main">
        <div class="suggest-title">${esc(item.title || item.url)}</div>
        <div class="suggest-url">${esc(item.url)}</div>
      </div>
    </div>`;
  });
  return html;
}

let suggestTimer = null;
let suggestSeq = 0;

// Подсказки показываются отдельным окном поверх страницы — основная панель
// браузера при этом не сдвигается.
async function showSuggestions() {
  const query = $('#omnibox').value.trim();
  if (!query) {
    hideSuggestions();
    return;
  }
  const wrap = $('#omnibox-wrap');
  const rect = wrap ? wrap.getBoundingClientRect() : null;
  if (!rect) return;
  try {
    await invoke('suggestions:show', {
      html: suggestionHtml(query),
      rect: { x: rect.left, y: rect.bottom, width: rect.width, height: rect.height },
    });
  } catch {}
}

function hideSuggestions() {
  invoke('suggestions:hide').catch(() => {});
}

function onOmniboxInput() {
  const query = $('#omnibox').value.trim();
  clearTimeout(suggestTimer);
  if (!query) {
    hideSuggestions();
    return;
  }
  const seq = ++suggestSeq;
  suggestTimer = setTimeout(async () => {
    try {
      const items = await invoke('history:list', { query, limit: 6 });
      if (seq !== suggestSeq) return;
      if (document.activeElement !== $('#omnibox')) return;
      S.suggestions = items || [];
      S.selected = -1;
      await showSuggestions();
    } catch {}
  }, 110);
}

function bindSuggestions() {
  // Подсказки живут в отдельном окне — клики обрабатываются там.
}

function chooseSuggestion(index) {
  const query = $('#omnibox').value.trim();
  const item = index >= 0 ? S.suggestions[index] : null;
  if (item) {
    invoke('tabs:navigate', { url: item.url }).catch((e) => toast(cleanError(e), 'error'));
  } else if (query) {
    invoke('tabs:navigate', { url: query }).catch((e) => toast(cleanError(e), 'error'));
  }
  hideSuggestions();
  $('#omnibox').blur();
}

function onOmniboxKeyDown(event) {
  if (event.key === 'Enter') {
    event.preventDefault();
    const query = $('#omnibox').value.trim();
    const item = S.selected >= 0 ? S.suggestions[S.selected] : null;
    if (item) invoke('tabs:navigate', { url: item.url }).catch(() => {});
    else if (query) invoke('tabs:navigate', { url: query }).catch(() => {});
    hideSuggestions();
    $('#omnibox').blur();
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (!S.suggestions.length && !$('#omnibox').value.trim()) return;
    S.selected = Math.min(S.suggestions.length - 1, S.selected + 1);
    showSuggestions();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    S.selected = Math.max(-1, S.selected - 1);
    showSuggestions();
  } else if (event.key === 'Escape') {
    hideSuggestions();
    const tab = activeTab();
    if (tab) $('#omnibox').value = tab.url === 'about:blank' ? '' : tab.url;
    $('#omnibox').blur();
  }
}

/* ------------------------------------------------------------------ find */
function openFind() {
  // Настройки — служебная вкладка без страницы: искать на ней нечего.
  if (S.mode === 'settings') return;
  if (S.mode !== 'web') setPanel('web');
  openDock(
    'find',
    `<div class="find-bar">
      <input id="find-input" type="text" placeholder="Найти на странице" value="${esc(S.find.text)}">
      <span class="find-count" id="find-count">${S.find.matches ? `${S.find.active}/${S.find.matches}` : ''}</span>
      <button class="icon-btn" id="find-prev" title="Предыдущее">${icon('back')}</button>
      <button class="icon-btn" id="find-next" title="Следующее">${icon('forward')}</button>
      <button class="icon-btn" id="find-close" title="Закрыть">${icon('close')}</button>
    </div>`,
    { focusSel: '#find-input' },
  );

  const input = $('#find-input');
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      findStep(event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape') {
      closeFind();
    }
  });
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      S.find.text = input.value;
      S.find.matches = 0;
      S.find.active = 0;
      invoke('tabs:find', { text: S.find.text, findNext: false, forward: true }).catch(() => {});
    }, 140);
  });
  $('#find-prev').addEventListener('click', () => findStep(-1));
  $('#find-next').addEventListener('click', () => findStep(1));
  $('#find-close').addEventListener('click', closeFind);

  if (S.find.text) {
    invoke('tabs:find', { text: S.find.text, findNext: false, forward: true }).catch(() => {});
  }
}

function findStep(direction) {
  const text = $('#find-input') ? $('#find-input').value : S.find.text;
  if (!text) return;
  S.find.text = text;
  invoke('tabs:find', { text, findNext: true, forward: direction > 0 }).catch(() => {});
}

function closeFind() {
  invoke('tabs:stop-find').catch(() => {});
  closeDock();
  $('#omnibox').focus();
}

function onFindResult(result) {
  S.find.matches = result.matches || 0;
  S.find.active = result.activeMatchOrdinal || 0;
  const el = $('#find-count');
  if (el) {
    el.textContent = S.find.matches ? `${S.find.active}/${S.find.matches}` : S.find.text ? 'нет' : '';
  }
}

/* ------------------------------------------------------------------ commands */
function onCommand(command) {
  if (!command) return;
  switch (command.type) {
    case 'boot-progress':
      setBootProgress(command.payload);
      break;
    case 'app-ready':
      setBootProgress(command.payload || { ready: true, done: 1, total: 1 });
      setTimeout(finishBoot, 180);
      break;
    case 'browser-fullscreen':
      S.fullscreen = !!(command.payload && command.payload.fullscreen);
      document.body.classList.toggle('browser-fullscreen', S.fullscreen);
      document.body.classList.toggle('fs-bar', S.fullscreen && !!(command.payload && command.payload.bar));
      document.body.classList.toggle('fs-media', S.fullscreen && !!(command.payload && command.payload.media));
      if (S.fullscreen) setPanel('web');
      break;
    case 'fullscreen-bar':
      document.body.classList.toggle('fs-bar', document.body.classList.contains('browser-fullscreen') && !!(command.payload && command.payload.visible));
      break;
    case 'fullscreen-media':
      document.body.classList.toggle('fs-media', document.body.classList.contains('browser-fullscreen') && !!(command.payload && command.payload.visible));
      break;
    case 'focus-omnibox':
      closeDock();
      $('#omnibox').focus();
      $('#omnibox').select();
      break;
    case 'close-dock':
      closeDock();
      hideSuggestions();
      break;
    case 'suggestion-pick':
      chooseSuggestion(command.payload && command.payload.index);
      break;
    case 'find-open':
      openFind();
      break;
    case 'clear-data':
      clearData(true);
      break;
    case 'toast':
      if (command.payload) toast(command.payload.text || '', command.payload.type || 'info');
      break;
    case 'player-scan':
      PLAYER.scan = command.payload || null;
      updatePlayerScan();
      break;
    case 'reader-toggle':
      $('#reader-btn').click();
      break;
    case 'escape':
      if (S.dock === 'find') {
        closeFind();
      } else if (S.dock) {
        closeDock();
      } else if (S.mode !== 'web') {
        if (S.mode === 'settings') invoke('settings:close-tab').catch(() => {});
        else setPanel('web');
      } else if (S.data && S.data.telegramOpen) {
        invoke('telegram:toggle', { open: false }).catch(() => {});
      }
      break;
  }
}

/* ------------------------------------------------------------------ chrome events */
function bindChrome() {
  $('#back').addEventListener('click', () => invoke('tabs:back').catch(() => {}));
  $('#forward').addEventListener('click', () => invoke('tabs:forward').catch(() => {}));
  $('#reload').addEventListener('click', () => {
    const tab = S.data && S.data.tabs.find((t) => t.id === S.data.activeTabId);
    invoke(tab && tab.loading ? 'tabs:stop' : 'tabs:reload').catch(() => {});
  });
  $('#new-tab-btn').addEventListener('click', () => invoke('tabs:create', {}).catch(() => {}));
  $('#tabstrip').addEventListener('dblclick', (event) => {
    if (!event.target.closest('.tab')) invoke('tabs:create', {}).catch(() => {});
  });
  $('#share-btn').addEventListener('click', async () => {
    try {
      await invoke('tabs:share-menu');
    } catch (err) {
      // Нативное меню недоступно — показываем обычную подсказку в доке.
      const tab = activeTab();
      const url = tab && tab.url ? tab.url : '';
      openDock('share', `
        <div class="menu-popover">
          <div class="menu-row" style="opacity:.7">${esc(tab && tab.title ? tab.title : 'Страница')}</div>
          <div class="menu-sep"></div>
          <button class="menu-row" data-share="copy"${url ? '' : ' disabled'}>Копировать ссылку</button>
          <button class="menu-row" data-share="telegram"${url ? '' : ' disabled'}>Отправить в Telegram</button>
          <button class="menu-row" data-share="vk"${url ? '' : ' disabled'}>Поделиться ВКонтакте</button>
          <button class="menu-row" data-share="mail"${url ? '' : ' disabled'}>Отправить по почте</button>
        </div>`);
      $$('[data-share]', $('#dock')).forEach((row) => {
        row.addEventListener('click', () => {
          const kind = row.dataset.share;
          closeDock();
          if (!url) return;
          if (kind === 'copy') {
            navigator.clipboard.writeText(url).then(
              () => toast('Ссылка скопирована', 'success'),
              () => toast('Не удалось скопировать ссылку', 'error'),
            );
            return;
          }
          const links = {
            telegram: `https://t.me/share/url?url=${encodeURIComponent(url)}`,
            vk: `https://vk.com/share.php?url=${encodeURIComponent(url)}`,
            mail: `mailto:?body=${encodeURIComponent(url)}`,
          };
          window.open(links[kind], '_blank', 'noopener');
        });
      });
    }
  });

  // Правый клик по пустому месту строки вкладок — меню окна, как в Chrome.
  // Там же переключается положение вкладок.
  $('#tabstrip').addEventListener('contextmenu', (event) => {
    if (event.target.closest('.tab') || event.target.closest('button')) return;
    event.preventDefault();
    invoke('menu:titlebar').catch(() => {});
  });

  $('#tabs').addEventListener('click', (event) => {
    if (S.dragId) return;
    const closeBtn = event.target.closest('.tab-close');
    const tabEl = event.target.closest('.tab');
    if (!tabEl) return;
    if (closeBtn) {
      event.stopPropagation();
      invoke('tabs:close', { id: tabEl.dataset.id }).catch(() => {});
    } else {
      invoke('tabs:select', { id: tabEl.dataset.id }).catch(() => {});
    }
  });
  $('#tabs').addEventListener('auxclick', (event) => {
    if (event.button !== 1) return;
    const tabEl = event.target.closest('.tab');
    if (!tabEl) return;
    invoke('tabs:close', { id: tabEl.dataset.id }).catch(() => {});
  });

  // Контекстное меню вкладки строит главный процесс (как в Chrome).
  $('#tabs').addEventListener('contextmenu', (event) => {
    const tabEl = event.target.closest('.tab');
    if (!tabEl) return;
    event.preventDefault();
    invoke('tabs:context-menu', { id: tabEl.dataset.id }).catch(() => {});
  });

  // Перетаскивание вкладок: порядок меняется сразу в DOM, а в главный
  // процесс уходит только итоговый список при отпускании.
  const finishTabDrag = (commit) => {
    const id = S.dragId;
    S.dragId = null;
    const container = $('#tabs');
    $$('.tab.dragging, .tab.drag-target', container).forEach((el) => {
      el.classList.remove('dragging', 'drag-target');
    });
    if (!id) return;
    if (!commit) {
      renderTabs();
      return;
    }
    const ids = $$('.tab:not(.tab-closing)', container).map((el) => el.dataset.id);
    invoke('tabs:reorder', { ids }).catch((e) => toast(cleanError(e), 'error'));
  };
  $('#tabs').addEventListener('dragstart', (event) => {
    const tabEl = event.target.closest('.tab');
    if (!tabEl || tabEl.classList.contains('tab-closing')) {
      event.preventDefault();
      return;
    }
    S.dragId = tabEl.dataset.id;
    tabEl.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', S.dragId);
  });
  $('#tabs').addEventListener('dragover', (event) => {
    if (!S.dragId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const container = $('#tabs');
    const dragged = S.tabEls.get(S.dragId);
    const target = event.target.closest('.tab');
    $$('.tab.drag-target', container).forEach((el) => el.classList.remove('drag-target'));
    if (!dragged || !target || target === dragged || target.classList.contains('tab-closing')) return;
    const vertical = getComputedStyle(container).flexDirection === 'column';
    const rect = target.getBoundingClientRect();
    const after = vertical ? event.clientY > rect.top + rect.height / 2 : event.clientX > rect.left + rect.width / 2;
    target.classList.add('drag-target');
    if (after) container.insertBefore(dragged, target.nextElementSibling);
    else container.insertBefore(dragged, target);
  });
  $('#tabs').addEventListener('drop', (event) => {
    if (!S.dragId) return;
    event.preventDefault();
    finishTabDrag(true);
  });
  $('#tabs').addEventListener('dragend', () => {
    if (S.dragId) finishTabDrag(false);
  });

  $('#omnibox').addEventListener('focus', () => {
    $('#omnibox').select();
    onOmniboxInput();
  });
  $('#omnibox').addEventListener('input', onOmniboxInput);
  $('#omnibox').addEventListener('keydown', onOmniboxKeyDown);
  // Контекстное меню адресной строки, как в Chrome. Действия выполняем явно:
  // роли нативного меню в Electron срабатывают на webContents страницы, а не
  // на поле адресной строки, поэтому «Вставить» и «Копировать» иногда ничего
  // не делали.
  const omniboxCommand = (command) => {
    const input = $('#omnibox');
    input.focus();
    try {
      document.execCommand(command);
    } catch {}
  };
  const omniboxPaste = async (navigate) => {
    let text = '';
    try {
      text = String(await invoke('clipboard:read-text') || '');
    } catch {}
    if (!text) return;
    const input = $('#omnibox');
    input.focus();
    if (navigate) {
      input.value = text.trim();
      hideSuggestions();
      invoke('tabs:navigate', { url: text.trim() }).catch((e) => toast(cleanError(e), 'error'));
      input.blur();
      return;
    }
    const start = input.selectionStart == null ? input.value.length : input.selectionStart;
    const end = input.selectionEnd == null ? input.value.length : input.selectionEnd;
    input.setRangeText(text, start, end, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  $('#omnibox').addEventListener('contextmenu', async (event) => {
    event.preventDefault();
    const input = $('#omnibox');
    input.focus();
    const hasSelection = input.selectionStart !== input.selectionEnd;
    const picked = await showNativeMenu(event, [
      { id: 'undo', label: 'Отменить', accelerator: 'Ctrl+Z' },
      { id: 'redo', label: 'Вернуть', accelerator: 'Ctrl+Y' },
      { type: 'separator' },
      { id: 'cut', label: 'Вырезать', accelerator: 'Ctrl+X', enabled: hasSelection },
      { id: 'copy', label: 'Копировать', accelerator: 'Ctrl+C', enabled: hasSelection },
      { id: 'paste', label: 'Вставить', accelerator: 'Ctrl+V' },
      { id: 'paste-go', label: 'Вставить и перейти', accelerator: 'Ctrl+Shift+V' },
      { type: 'separator' },
      { id: 'select-all', label: 'Выделить всё', accelerator: 'Ctrl+A' },
      { type: 'separator' },
      { id: 'copy-url', label: 'Копировать адрес страницы' },
    ]);
    if (!picked) return;
    if (picked === 'select-all') {
      input.select();
    } else if (picked === 'undo' || picked === 'redo') {
      omniboxCommand(picked);
    } else if (picked === 'copy' || picked === 'cut') {
      const start = input.selectionStart || 0;
      const end = input.selectionEnd || 0;
      const text = input.value.slice(start, end);
      if (text) {
        invoke('clipboard:write-text', { text }).catch(() => {});
      }
      if (picked === 'cut' && text) {
        input.setRangeText('', start, end, 'end');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } else if (picked === 'paste') {
      await omniboxPaste(false);
    } else if (picked === 'paste-go') {
      await omniboxPaste(true);
    } else if (picked === 'copy-url') {
      const tab = activeTab();
      if (tab) invoke('clipboard:write-text', { text: tab.url }).catch(() => {});
    }
  });
  $('#omnibox').addEventListener('blur', () => {
    setTimeout(() => {
      if (S.dock === 'suggest') closeDock();
      hideSuggestions();
    }, 150);
  });

  $('#star').addEventListener('click', () => toggleBookmark().catch((e) => toast(cleanError(e), 'error')));
  $('#blocked-chip').addEventListener('click', () => {
    const tab = activeTab();
    const blocked = (S.data.tabs.find((t) => t.id === S.data.activeTabId) || {}).blocked || 0;
    toast(`На этой странице заблокировано запросов: ${blocked}. Домены-источники можно посмотреть в настройках.`);
  });

  $('#vpn-chip').addEventListener('click', () => {
    if (S.mode === 'vpn') setPanel('web');
    else setPanel('vpn');
  });
  $('#timer-chip').addEventListener('click', () => {
    invoke('tabs:create', { url: 'arch://newtab' }).catch(() => {});
  });
  $('#alarm-chip').addEventListener('click', () => {
    invoke('tabs:create', { url: 'arch://newtab' }).catch(() => {});
  });
  $('#fullscreen-btn').addEventListener('click', () => {
    invoke('window:fullscreen').catch((err) => toast(cleanError(err), 'error'));
  });
  $('#bookmarks-bar-btn').addEventListener('click', async () => {
    const current = !!(S.data && S.data.settings && S.data.settings.showBookmarksBar);
    await applySetting('showBookmarksBar', !current);
    await refreshState();
  });
  $('#reader-btn').addEventListener('click', toggleReaderMode);
  playerBindAudio();
  $('#media-bar-toggle').addEventListener('click', toggleMediaPlayback);
  $('#media-bar-prev').addEventListener('click', playerPrev);
  $('#media-bar-next').addEventListener('click', () => playerNext(1));
  $('#media-bar-shuffle').addEventListener('click', playerToggleShuffle);
  $('#media-bar-repeat').addEventListener('click', playerToggleRepeat);
  $('#media-bar-repeat').addEventListener('contextmenu', playerRepeatMenu);
  $('#media-bar-close').addEventListener('click', async () => {
    const el = PLAYER.element;
    if (PLAYER.current && el) {
      try {
        el.pause();
        el.removeAttribute('src');
        el.load();
      } catch {}
    }
    PLAYER.current = null;
    PLAYER.closed = true;
    const page = (S.data && S.data.player && S.data.player.page) || {};
    if (page.active) invoke('player:control', { action: 'stop' }).catch(() => {});
    updateMediaBar();
    updatePlayerPanel();
  });
  $('#media-bar-mute').addEventListener('click', () => playerSetVolume(PLAYER.volume, !PLAYER.muted));
  $('#media-bar-volume').addEventListener('input', (event) => playerSetVolume(Number(event.target.value), false));
  $('#media-bar-seek').addEventListener('input', (event) => {
    const el = PLAYER.element;
    const value = Number(event.target.value) || 0;
    const page = (S.data && S.data.player && S.data.player.page) || {};
    const duration = PLAYER.current && el ? (el.duration || 0) : (page.duration || 0);
    if (!duration) return;
    if (PLAYER.current && el) {
      el.currentTime = value * duration;
      updatePlayerPanel();
    }
  });
  $('#telegram-btn').addEventListener('click', () => {
    closeDock();
    invoke('telegram:toggle', {}).catch((err) => toast(cleanError(err), 'error'));
  });
  $('#telegram-btn').addEventListener('contextmenu', (event) => {
    event.preventDefault();
    invoke('telegram:context-menu').catch(() => {});
  });
  const setCompactToolbar = async (value) => {
    document.body.classList.toggle('toolbar-collapsed', value);
    const cBtn = $('#toolbar-collapse');
    const eBtn = $('#toolbar-expand');
    if (cBtn) cBtn.classList.toggle('hidden', value);
    if (eBtn) eBtn.classList.toggle('hidden', !value);
    try {
      await invoke('settings:set', { compactToolbar: value });
      if (S.data && S.data.settings) S.data.settings.compactToolbar = value;
    } catch (err) {
      toast(cleanError(err), 'error');
    }
  };
  $('#toolbar-collapse').addEventListener('click', () => setCompactToolbar(true));
  $('#toolbar-expand').addEventListener('click', () => setCompactToolbar(false));
  $('#player-btn').addEventListener('click', () => {
    if (S.mode === 'player') setPanel('web');
    else setPanel('player');
  });
  $('#torrent-btn').addEventListener('click', () => {
    if (S.mode === 'torrent') setPanel('web');
    else setPanel('torrent');
  });
  $('#downloads-btn').addEventListener('click', () => {
    if (S.mode === 'downloads') setPanel('web');
    else setPanel('downloads');
  });
  $('#extensions-btn').addEventListener('click', () => {
    if (S.mode === 'extensions') setPanel('web');
    else setPanel('extensions');
  });
  $('#menu-btn').addEventListener('click', () => {
    closeDock();
    // Нативное меню всегда рисуется поверх WebContentsView и корректно
    // работает при любом положении вкладок.
    invoke('menu:popup').catch(() => {
      openDock('menu', menuTemplate());
      $$('[data-action]', $('#dock')).forEach((row) => {
        row.addEventListener('click', () => menuAction(row.dataset.action));
      });
    });
  });

  $('#dock').addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (S.dock === 'find') closeFind();
      else closeDock();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {      if (S.dock === 'find') closeFind();
      else if (S.dock) closeDock();
      else if ($('#torrent-modal-root')) closeTorrentModal();
      else if (S.mode === 'settings') invoke('settings:close-tab').catch(() => {});
      else if (activeTab() && activeTab().service) invoke('tabs:close', { id: activeTab().id }).catch(() => {});
      else if (S.mode !== 'web') setPanel('web');
      return;
    }
    // Alt+R — режим чтения.
    if (event.altKey && !event.ctrlKey && !event.metaKey && (event.key === 'r' || event.key === 'R' || event.code === 'KeyR')) {
      event.preventDefault();
      toggleReaderMode();
    }
  });

  bindUiTextContextMenu();
}

// Режим чтения: убирает всё лишнее и оставляет только текст статьи.
async function toggleReaderMode() {
  const btn = $('#reader-btn');
  if (btn) btn.classList.add('busy');
  try {
    const on = await invoke('tabs:reader-mode');
    if (btn) btn.classList.toggle('active', !!on);
    toast(on ? 'Режим чтения включён' : 'Режим чтения выключен', on ? 'success' : 'info');
  } catch (err) {
    toast(cleanError(err), 'error');
  } finally {
    if (btn) btn.classList.remove('busy');
  }
}

function bindPanel() {
  $('#panel').addEventListener('pointerdown', () => { S.panelPointerDown = true; }, true);
  const releasePointer = () => {
    // Отпускаем после click, чтобы обработчик успел сработать.
    setTimeout(() => { S.panelPointerDown = false; }, 0);
  };
  window.addEventListener('pointerup', releasePointer, true);
  window.addEventListener('pointercancel', releasePointer, true);
  window.addEventListener('blur', releasePointer);
  $('#panel-close').addEventListener('click', () => {
    const tab = activeTab();
    if (tab && tab.service) invoke('tabs:close', { id: tab.id }).catch(() => {});
    else setPanel('web');
  });
  $('#panel').addEventListener('click', (event) => {
    if (event.target === $('#panel')) return;
  });
}
