'use strict';

const path = require('path');
const crypto = require('crypto');
const {
  app,
  BrowserWindow,
  WebContentsView,
  Menu,
  shell,
  clipboard,
  dialog,
  screen,
} = require('electron');

const CHROME_BASE = 92;
const SERVICE_TITLES = {
  settings: 'Настройки',
  player: 'Плеер',
  torrent: 'BitTorrent',
  vpn: 'VPN',
  extensions: 'Расширения',
  downloads: 'Загрузки',
  history: 'История',
  bookmarks: 'Закладки',
  about: 'О браузере',
};
const SERVICE_FIELDS = {
  settings: 'settingsTabId',
  player: 'playerTabId',
  torrent: 'torrentTabId',
  vpn: 'vpnTabId',
  extensions: 'extensionsTabId',
  downloads: 'downloadsTabId',
  history: 'historyTabId',
  bookmarks: 'bookmarksTabId',
  about: 'aboutTabId',
};
const TRACKING_PARAMS = [
  /^utm_/i,
  /^ga_/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^dclid$/i,
  /^yclid$/i,
  /^msclkid$/i,
  /^mc_eid$/i,
  /^igshid$/i,
  /^_openstat$/i,
  /^vero_id$/i,
  /^wickedid$/i,
  /^oly_enc_id$/i,
  /^oly_anon_id$/i,
  /^rb_clickid$/i,
  /^s_cid$/i,
  /^mkt_tok$/i,
];

function cleanTrackingParams(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (!/^https?:$/.test(u.protocol)) return rawUrl;
    let changed = false;
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.some((re) => re.test(key))) {
        u.searchParams.delete(key);
        changed = true;
      }
    }
    return changed ? u.toString() : rawUrl;
  } catch {
    return rawUrl;
  }
}

function isInternal(url) {
  return typeof url === 'string' && url.startsWith('arch://');
}

class BrowserWindowController {
  constructor(ctx, { isPrivate = false, hidden = false, bootOverlay = false } = {}) {
    this.ctx = ctx;
    this.isPrivate = isPrivate;
    this.hidden = hidden;
    this.bootOverlay = bootOverlay;
    this.id = crypto.randomUUID();
    this.tabs = new Map();
    this.order = [];
    this.activeId = null;
    this.uiMode = 'web';
    this.settingsTabId = null;
    this.playerTabId = null;
    this.torrentTabId = null;
    this.vpnTabId = null;
    this.extensionsTabId = null;
    this.downloadsTabId = null;
    this.historyTabId = null;
    this.bookmarksTabId = null;
    this.aboutTabId = null;
    this.chromeHeight = CHROME_BASE;
    this.pageInsets = { top: CHROME_BASE, left: 0, right: 0, bottom: 0 };
    this.timerState = { running: false, left: 0, label: '', alarm: '' };
    this.htmlFullscreen = false;
    this.browserFullscreen = false;
    this._fsBarVisible = false;
    this._fsMediaVisible = false;
    this._mediaBarVisible = false;
    this._overlayHolds = 0;
    this._fsTopEnterAt = 0;
    this._fsMediaEnterAt = 0;
    this._fsWatch = null;
    this._fsHideTimer = null;
    this._preFullscreenInsets = null;
    this.destroyed = false;
    this._bTimer = null;
    this._lastFind = '';
    this._window = null;
    this.telegramOpen = false;
    this.telegramUnread = 0;
    this.telegramWidth = 400;
    this._telegramCurrentWidth = 0;
    this._telegramAnim = null;
    this.telegram = null;

    this.ses = isPrivate
      ? ctx.session.fromPartition('arch-private-' + crypto.randomUUID())
      : ctx.mainSession;
    this.ses.setUserAgent(ctx.userAgent, ctx.acceptLanguages);
    ctx.attachSession(this.ses, { isPrivate });
    ctx.vpn.registerSession(this.ses);

    this.createWindow();
    this.createTab(ctx.settings.get('homepage') || 'arch://newtab');
  }

  get window() {
    return this._window;
  }

  createWindow() {
    const theme = this.ctx.theme ? this.ctx.theme() : null;
    const iconPath = path.join(
      this.ctx.assetsDir,
      process.platform === 'win32' ? 'icon.ico' : 'icon.png',
    );
    const isMac = process.platform === 'darwin';
    const macOptions = isMac
      ? {
          titleBarStyle: 'hiddenInset',
        }
      : {
          titleBarStyle: 'hidden',
          titleBarOverlay: theme
            ? { color: theme.overlayColor, symbolColor: theme.overlaySymbol, height: 40 }
            : { color: '#202020', symbolColor: '#f2f2f2', height: 40 },
        };
    const win = new BrowserWindow({
      width: 1440,
      height: 920,
      minWidth: 960,
      minHeight: 640,
      show: false,
      backgroundColor: theme ? theme.background : '#1a1a1a',
      title: this.isPrivate ? 'ArchBrowser — Приватное окно' : 'ArchBrowser',
      autoHideMenuBar: true,
      ...macOptions,
      icon: iconPath,
      webPreferences: {
        preload: this.ctx.uiPreload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        backgroundThrottling: false,
      },
    });
    this._window = win;
    try { win.setIcon(iconPath); } catch {}
    // Windows использует AppUserModelID и иконку приложения для кнопки на
    // панели задач. Без этого в режиме исходников видна иконка Electron.
    try {
      if (process.platform === 'win32' && typeof win.setAppDetails === 'function') {
        const relaunch = process.defaultApp
          ? `"${process.execPath}" "${app.getAppPath()}"`
          : `"${process.execPath}"`;
        win.setAppDetails({
          appId: process.defaultApp ? 'com.archbrowser.desktop.dev' : 'com.archbrowser.desktop',
          // В собранной версии иконка вшита в exe; путь внутри asar Windows
          // для панели задач не читает.
          appIconPath: app.isPackaged ? process.execPath : iconPath,
          appIconIndex: 0,
          relaunchCommand: relaunch,
        });
      }
    } catch {}
    win.setMenuBarVisibility(false);
    win.loadFile(path.join(__dirname, 'ui', 'index.html'));
    if (!this.hidden) {
      win.once('ready-to-show', () => {
        if (!win.isDestroyed()) win.show();
      });
    }

    win.on('resize', () => {
      this.layout();
      this._repositionToast();
    });
    win.on('move', () => this._repositionToast());
    win.on('maximize', () => this.layout());
    win.on('unmaximize', () => this.layout());
    win.on('enter-full-screen', () => this._setBrowserFullscreen(true));
    win.on('leave-full-screen', () => this._setBrowserFullscreen(false));
    win.on('closed', () => this.destroy());

    // Окно закрывает приложение целиком: никаких фоновых процессов.

    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    win.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
        this.toggleDevTools();
        event.preventDefault();
      }
      if (input.control && input.key.toLowerCase() === 'l') {
        this.sendCommand('focus-omnibox');
        event.preventDefault();
      }
      if (input.control && input.key.toLowerCase() === 'f') {
        this.sendCommand('find-open');
        event.preventDefault();
      }
      if (input.key === 'F11') {
        this.toggleBrowserFullscreen();
        event.preventDefault();
      }
      if (input.key === 'Escape') {
        if (this.browserFullscreen) {
          this.exitBrowserFullscreen();
          event.preventDefault();
        } else {
          this.sendCommand('escape');
        }
      }
    });
  }

  sendCommand(type, payload) {
    if (this._window && !this._window.isDestroyed()) {
      this._window.webContents.send('command', { type, payload });
    }
  }

  // ---------------- Tabs ----------------

  createTab(url = this.ctx.settings.get('newTabPage') || 'arch://newtab', { active = true } = {}) {
    if (this.destroyed) return null;
    const id = crypto.randomUUID();
    const view = new WebContentsView({
      webPreferences: {
        preload: this.ctx.pagePreload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        session: this.ses,
        spellcheck: false,
        backgroundThrottling: false,
        safeDialogs: true,
        additionalArguments: [
          `--arch-fp=${this.ctx.settings.get('fingerprintProtection') ? '1' : '0'}`,
        ],
      },
    });

    const wc = view.webContents;
    const tab = {
      id,
      view,
      wc,
      title: 'Новая вкладка',
      url: 'about:blank',
      // Служебная вкладка: settings / player / torrent. Такая вкладка
      // показывает не веб-страницу, а панель интерфейса браузера.
      service: null,
      favicon: null,
      loading: true,
      // 0…1 — прогресс загрузки для тонкой полоски во вкладке.
      progress: 0,
      progressTimer: null,
      // Таймер «страница вообще не отвечает».
      loadTimer: null,
      // Таймер отложенного показа индикатора загрузки (анти-мерцание).
      loadingTimer: null,
      watchUrl: '',
      errorPage: false,
      proxyRetryUrl: '',
      blocked: 0,
      error: null,
      audible: false,
      bookmarked: false,
    };
    this.tabs.set(id, tab);
    this.order.push(id);
    this._attachView(view, !this.bootOverlay && this.uiMode === 'web' && active);

    try {
      wc.setWebRTCIPHandlingPolicy(
        this.ctx.settings.get('webrtcLeakProtection') ? 'disable_non_proxied_udp' : 'default',
      );
    } catch {}

    wc.setZoomFactor(1);

    wc.setWindowOpenHandler(({ url: target }) => {
      if (!target || target === 'about:blank') return { action: 'deny' };
      if (/^(https?|arch|vless|vmess|trojan|ss):/i.test(target)) {
        this.createTab(
          this.ctx.settings.get('stripTrackingParams') ? cleanTrackingParams(target) : target,
          { active: true },
        );
      } else if (/^magnet:/i.test(target)) {
        // Ссылку из target="_blank" забирает встроенный клиент, а не ОС.
        this.openMagnet(target);
      } else if (/^(mailto|tel):/i.test(target)) {
        shell.openExternal(target).catch(() => {});
      }
      return { action: 'deny' };
    });

    wc.on('will-navigate', (event, target) => {
      const url = String(target || '');
      // Ссылки magnet:/vless:/mailto: внутри страницы не являются http-
      // адресами: Chromium не умеет их открывать и клик «ничего не делает».
      // Перехватываем и передаём встроенному клиенту/VPN/системе.
      if (/^magnet:/i.test(url)) {
        event.preventDefault();
        this.openMagnet(url);
        return;
      }
      if (/^(vless|vmess|trojan|ss):\/\//i.test(url)) {
        event.preventDefault();
        this._importProxyLink(url);
        return;
      }
      if (/^(mailto|tel):/i.test(url)) {
        event.preventDefault();
        shell.openExternal(url).catch(() => {});
        return;
      }
      if (url && !/^(https?|file|arch|about|blob|data):/i.test(url)) {
        event.preventDefault();
      }
    });

    wc.on('did-start-navigation', (_e, target, isInPlace, isMainFrame) => {
      if (!isMainFrame || isInPlace) return;
      const text = String(target || '');
      // Служебная вкладка (настройки, плеер, torrent). Если пользователь ушёл
      // с неё по ссылке, она становится обычной вкладкой.
      if (tab.service && text !== `arch://${tab.service}`) {
        for (const field of Object.values(SERVICE_FIELDS)) {
          if (tab.id === this[field]) this[field] = null;
        }
        tab.service = null;
        tab.isSettings = false;
      }
      // Служебная страница ошибки не подменяет адрес в строке.
      if (text.startsWith('arch://error')) {
        tab.errorPage = true;
        this._clearLoadWatch(tab);
        return;
      }
      if (/^(https?|arch|file):/i.test(text) || text === 'about:blank') {
        tab.errorPage = false;
        tab.url = text;
        tab.error = null;
        this._startTabProgress(tab);
        this._startLoadWatch(tab, text);
        this._scheduleBroadcast();
      }
    });

    wc.on('did-start-loading', () => {
      // Индикатор загрузки показываем с задержкой: если страница (или её
      // фоновые опросы) перезагружается быстрее, спиннер не мерцает.
      if (tab.loadingTimer) clearTimeout(tab.loadingTimer);
      tab.loadingTimer = setTimeout(() => {
        tab.loadingTimer = null;
        tab.loading = true;
        if (!tab.errorPage) tab.error = null;
        if (tab.challengeTimer) {
          clearTimeout(tab.challengeTimer);
          tab.challengeTimer = null;
        }
        this._scheduleBroadcast();
      }, 180);
    });

    // Главный документ пришёл — страница «ответила», таймаут больше не нужен.
    wc.on('dom-ready', () => {
      this._clearLoadWatch(tab);
      if (tab.progress > 0 && tab.progress < 0.75) {
        tab.progress = 0.75;
        this._scheduleBroadcast();
      }
    });

    wc.on('did-stop-loading', () => {
      if (tab.loadingTimer) { clearTimeout(tab.loadingTimer); tab.loadingTimer = null; }
      tab.loading = false;
      this._clearLoadWatch(tab);
      this._finishTabProgress(tab);
      this._scheduleBroadcast();
      this._watchChallenge(tab);
    });

    wc.on('did-navigate', (_e, target) => {
      if (tab.errorPage || String(target).startsWith('arch://error')) return;
      tab.url = target;
      if (!this.isPrivate && /^https?:/i.test(target)) {
        this.ctx.recordHistory(target, tab.title, wc);
      }
      this._scheduleBroadcast();
    });

    wc.on('did-navigate-in-page', (_e, target, isMainFrame) => {
      if (!isMainFrame || tab.errorPage) return;
      tab.url = target;
      this._scheduleBroadcast();
    });

    wc.on('page-title-updated', (_e, title) => {
      if (tab.errorPage) return;
      tab.title = tab.service
        ? (SERVICE_TITLES[tab.service] || 'ArchBrowser')
        : (title || this._hostOf(tab.url) || 'Без названия');
      if (!this.isPrivate && /^https?:/i.test(tab.url)) {
        this.ctx.updateHistoryTitle(tab.url, tab.title);
      }
      this._setWindowTitle();
      this._scheduleBroadcast();
    });

    wc.on('page-favicon-updated', (_e, favicons) => {
      if (Array.isArray(favicons) && favicons.length) {
        tab.favicon = favicons[0];
        // Сохраняем иконку по хосту, чтобы показывать её в панели закладок
        // и в новых вкладках без повторного визита на сайт.
        if (tab.url && /^https?:/i.test(tab.url)) {
          this.ctx.recordFavicon(tab.url, favicons[0]);
        }
        this._scheduleBroadcast();
      }
    });

    wc.on('did-fail-load', async (_e, code, description, validatedURL, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      if (tab.errorPage || String(validatedURL || '').startsWith('arch://error')) return;
      console.error('[tab] load failed:', code, description, validatedURL);
      if (tab.loadingTimer) { clearTimeout(tab.loadingTimer); tab.loadingTimer = null; }
      tab.loading = false;
      tab.error = `${description || 'Ошибка загрузки'} (${code})`;
      tab.url = validatedURL || tab.url;
      this._clearLoadWatch(tab);
      this._finishTabProgress(tab);
      this._scheduleBroadcast();

      const url = validatedURL || tab.url;
      // Прокси-ошибки при включённом VPN: если туннель умер, возвращаем прямое
      // соединение и повторяем загрузку. Иначе все страницы «не грузятся»,
      // хотя индикатор VPN зелёный.
      if ((code === -130 || code === -111 || code === -120) && /^https?:/i.test(url || '')) {
        let recovered = false;
        try {
          recovered = await this.ctx.vpn.recoverIfDead();
        } catch {}
        if (recovered && !tab.wc.isDestroyed() && this.tabs.has(tab.id)) {
          this.showToast('VPN не отвечает — страницы открываются напрямую', 'warning');
          tab.proxyRetryUrl = url;
          tab.errorPage = false;
          setTimeout(() => {
            if (!tab.wc.isDestroyed() && this.tabs.has(tab.id)) tab.wc.loadURL(url).catch(() => {});
          }, 300);
          return;
        }
      }
      // Сайт из «прямого» списка (.ru/.рф) не открылся напрямую — один раз
      // повторяем загрузку через VPN, без участия пользователя.
      if (/^https?:/i.test(url || '') && tab.proxyRetryUrl !== url) {
        let retried = false;
        try {
          retried = await this.ctx.vpn.markDirectFailure(url);
        } catch {}
        if (retried && !tab.wc.isDestroyed() && this.tabs.has(tab.id)) {
          tab.proxyRetryUrl = url;
          tab.errorPage = false;
          setTimeout(() => {
            if (!tab.wc.isDestroyed() && this.tabs.has(tab.id)) {
              tab.wc.loadURL(url).catch(() => {});
            }
          }, 350);
          return;
        }
      }
      if (/^https?:/i.test(url || '')) {
        // -7/-118 — сервер не ответил вовсе: это и есть «страница не отвечает».
        const kind = code === -7 || code === -118 ? 'timeout' : 'net';
        this._showErrorPage(tab, { kind, url, code, desc: description });
      }
    });

    wc.on('render-process-gone', (_e, details) => {
      if (tab.loadingTimer) { clearTimeout(tab.loadingTimer); tab.loadingTimer = null; }
      tab.loading = false;
      tab.error = `Процесс страницы завершился: ${details.reason}`;
      this._clearLoadWatch(tab);
      this._stopTabProgress(tab);
      this._scheduleBroadcast();
    });

    wc.on('audio-state-changed', () => {
      try {
        tab.audible = wc.isCurrentlyAudible();
      } catch {
        tab.audible = false;
      }
      this._scheduleBroadcast();
    });

    wc.on('enter-html-full-screen', () => {
      this.htmlFullscreen = true;
      this._updateVisibility();
      this.layout();
      this._scheduleBroadcast();
    });

    wc.on('leave-html-full-screen', () => {
      this.htmlFullscreen = false;
      this._updateVisibility();
      this.layout();
      this._scheduleBroadcast();
    });

    wc.on('context-menu', (_e, params) => this._showContextMenu(tab, params));

    wc.on('found-in-page', (_e, result) => {
      if (this._window && !this._window.isDestroyed()) {
        this._window.webContents.send('find-result', {
          matches: result.matches,
          activeMatchOrdinal: result.activeMatchOrdinal,
          finalUpdate: result.finalUpdate,
        });
      }
    });

    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const key = input.key;
      if (key === 'F12' || (input.control && input.shift && key.toLowerCase() === 'i')) {
        this.toggleDevTools();
        event.preventDefault();
      } else if (input.control && key.toLowerCase() === 'l') {
        this.sendCommand('focus-omnibox');
        event.preventDefault();
      } else if (input.control && key.toLowerCase() === 'f') {
        this.sendCommand('find-open');
        event.preventDefault();
      } else if (key === 'F11') {
        this.toggleBrowserFullscreen();
        event.preventDefault();
      } else if (key === 'Escape') {
        if (this.browserFullscreen) {
          this.exitBrowserFullscreen();
          event.preventDefault();
        } else {
          this.sendCommand('escape');
        }
      } else if (key === 'F5' || (input.control && key.toLowerCase() === 'r')) {
        if (input.shift) wc.reloadIgnoringCache();
        else wc.reload();
        event.preventDefault();
      } else if (input.alt && key === 'Left') {
        this.goBack();
        event.preventDefault();
      } else if (input.alt && key === 'Right') {
        this.goForward();
        event.preventDefault();
      }
    });

    if (active) this.selectTab(id, { keepPanel: true });
    else this._scheduleBroadcast();

    const target = this.normalizeInput(url) || 'arch://newtab';
    const loadTarget = this._importProxyLink(target) ? 'arch://newtab' : target;
    wc.loadURL(loadTarget).catch((err) => {
      // Отмена предыдущей навигации и служебная страница ошибки — не ошибка.
      if (tab.errorPage || /ERR_ABORTED/i.test(String(err && err.message))) return;
      tab.error = err.message;
      tab.loading = false;
      this._scheduleBroadcast();
    });

    return tab;
  }

  closeTab(id) {
    const tab = this.tabs.get(id);
    if (!tab) return;
    if (this.tabs.size <= 1) {
      // Закрывается последняя вкладка. Если это служебная вкладка (плеер,
      // настройки, торрент) — не закрываем окно, а открываем стартовую
      // страницу, иначе после закрытия обычной вкладки браузер бы закрылся.
      if (tab.service) {
        this.createTab(this.ctx.settings.get('newTabPage') || 'arch://newtab', { active: false });
      } else {
        this._window.close();
        return;
      }
    }
    const index = this.order.indexOf(id);
    if (tab.id === this.settingsTabId) this.settingsTabId = null;
    if (tab.id === this.playerTabId) this.playerTabId = null;
    if (tab.id === this.torrentTabId) this.torrentTabId = null;
    let promote = null;

    if (this.activeId === id) {
      promote = this.order[Math.min(index, this.order.length - 1)];
    }

    this.tabs.delete(id);
    this.order.splice(index, 1);
    try {
      this._window.contentView.removeChildView(tab.view);
      if (!tab.wc.isDestroyed()) tab.wc.close();
    } catch {}
    this.ctx.privacy.resetCounters(tab.wc ? tab.wc.id : undefined);
    if (promote && this.tabs.has(promote)) {
      this.selectTab(promote, { keepPanel: true });
    } else if (this.activeId && this.tabs.has(this.activeId)) {
      this._updateVisibility();
      this.layout();
      this._scheduleBroadcast();
    } else {
      const nextId = this.order[Math.min(index, this.order.length - 1)];
      if (nextId) this.selectTab(nextId, { keepPanel: true });
    }
  }

  closeOtherTabs(id) {
    if (!this.tabs.has(id)) return;
    for (const other of [...this.order]) {
      if (other !== id) this.closeTab(other);
    }
  }

  closeTabsToRight(id) {
    const index = this.order.indexOf(id);
    if (index < 0) return;
    for (const other of this.order.slice(index + 1)) this.closeTab(other);
  }

  reorderTabs(ids) {
    if (!Array.isArray(ids) || ids.length !== this.order.length) return;
    const current = new Set(this.order);
    const next = [];
    for (const id of ids) {
      if (!current.has(id) || next.includes(id)) return;
      next.push(id);
    }
    this.order = next;
    this._scheduleBroadcast();
  }

  _showTabContextMenu(id) {
    const tab = this.tabs.get(id);
    if (!tab || !this._window || this._window.isDestroyed()) return;
    const index = this.order.indexOf(id);
    const canCloseRight = index >= 0 && index < this.order.length - 1;
    const canCloseOthers = this.order.length > 1;
    const items = [
      {
        label: 'Новая вкладка',
        click: () => this.createTab(this.ctx.settings.get('newTabPage') || 'arch://newtab'),
      },
      {
        label: tab.loading ? 'Остановить загрузку' : 'Перезагрузить',
        click: () => {
          if (tab.loading) tab.wc.stop();
          else tab.wc.reload();
        },
      },
      {
        label: 'Дублировать',
        click: () => this.createTab(tab.url, { active: true }),
      },
      { type: 'separator' },
      {
        label: 'Копировать адрес',
        click: () => clipboard.writeText(tab.url || ''),
      },
      {
        label: this.ctx.bookmarks.has(tab.url) ? 'Удалить из закладок' : 'Добавить в закладки',
        enabled: /^https?:/i.test(tab.url || ''),
        click: () => {
          this.ctx.bookmarks.toggle({ url: tab.url, title: tab.title });
          this._scheduleBroadcast();
        },
      },
      { type: 'separator' },
      {
        label: 'Закрыть вкладку',
        accelerator: 'Ctrl+W',
        click: () => this.closeTab(id),
      },
      {
        label: 'Закрыть другие вкладки',
        enabled: canCloseOthers,
        click: () => this.closeOtherTabs(id),
      },
      {
        label: 'Закрыть вкладки справа',
        enabled: canCloseRight,
        click: () => this.closeTabsToRight(id),
      },
    ];
    Menu.buildFromTemplate(items).popup({ window: this._window });
  }

  // Главное меню рисуем нативным popup: DOM-док оказывается под
  // WebContentsView при вертикальных/нижних вкладках.
  popupMainMenu() {
    if (!this._window || this._window.isDestroyed()) return;
    const items = [
      {
        label: 'Новая вкладка',
        accelerator: 'CmdOrCtrl+T',
        click: () => this.createTab(this.ctx.settings.get('newTabPage') || 'arch://newtab'),
      },
      {
        label: 'Новое приватное окно',
        accelerator: 'CmdOrCtrl+Shift+N',
        click: () => this.ctx.createWindow({ isPrivate: true }),
      },
      { type: 'separator' },
      { label: 'История', accelerator: 'CmdOrCtrl+H', click: () => this.setUIMode('history') },
      { label: 'Закладки', accelerator: 'CmdOrCtrl+Shift+O', click: () => this.setUIMode('bookmarks') },
      { label: 'Загрузки', accelerator: 'CmdOrCtrl+J', click: () => this.setUIMode('downloads') },
      { label: 'Расширения', click: () => this.setUIMode('extensions') },
      { label: 'VPN', click: () => this.setUIMode('vpn') },
      { label: 'Telegram', accelerator: 'CmdOrCtrl+Shift+M', click: () => this.toggleTelegram() },
      ...(this.ctx.settings.get('featureLocalPlayer') === false ? [] : [{
        label: 'Плеер',
        click: () => this.setUIMode('player'),
      }]),
      ...(this.ctx.settings.get('featureBittorrent') === false ? [] : [{
        label: 'BitTorrent',
        click: () => this.setUIMode('torrent'),
      }]),
      { type: 'separator' },
      { label: 'Поделиться страницей…', click: () => this.shareCurrentTab() },
      { label: 'Таймер и будильник…', click: () => this.createTab('arch://newtab') },
      { label: 'Полный экран', accelerator: 'F11', click: () => this.toggleBrowserFullscreen() },
      {
        label: this.ctx.settings.get('compactToolbar') ? 'Показать кнопки справа' : 'Скрыть кнопки справа',
        click: () => {
          this.ctx.settings.set({ compactToolbar: !this.ctx.settings.get('compactToolbar') });
          this.ctx.broadcastAll?.();
          this._scheduleBroadcast();
        },
      },
      {
        label: this.ctx.settings.get('showBookmarksBar') ? 'Скрыть панель закладок' : 'Показать панель закладок',
        click: () => {
          this.ctx.settings.set({ showBookmarksBar: !this.ctx.settings.get('showBookmarksBar') });
          this.ctx.broadcastAll?.();
          this._scheduleBroadcast();
        },
      },
      { label: 'Режим чтения', accelerator: 'Alt+R', click: () => this.sendCommand('reader-toggle') },
      { type: 'separator' },
      { label: 'Настройки', accelerator: 'CmdOrCtrl+,', click: () => this.setUIMode('settings') },
      { label: 'Добавить страницу в закладки', accelerator: 'CmdOrCtrl+D', click: () => this.toggleBookmark() },
      { label: 'Очистить данные…', accelerator: 'CmdOrCtrl+Shift+Delete', click: () => this.sendCommand('clear-data') },
      {
        label: 'О программе',
        click: () => dialog.showMessageBox(this._window, {
          type: 'info',
          title: 'ArchBrowser',
          message: 'ArchBrowser',
          detail: `Приватный браузер на Chromium ${this.ctx.chromeVersion}\nВерсия ${this.ctx.appVersion}`,
          buttons: ['OK'],
        }),
      },
      { type: 'separator' },
      { label: 'Выйти', accelerator: 'Alt+F4', role: 'quit' },
    ];
    Menu.buildFromTemplate(items).popup({ window: this._window });
  }

  // Контекстное меню заголовка/пустого места строки вкладок. Положение
  // вкладок переключается здесь же, без похода в настройки.
  popupTitlebarMenu() {
    if (!this._window || this._window.isDestroyed()) return;
    const position = this.ctx.settings.get('tabPosition') || 'top';
    const setPosition = (value) => {
      this.ctx.settings.set({ tabPosition: value });
      this.ctx.broadcastAll?.();
      this._scheduleBroadcast();
    };
    const items = [
      {
        label: 'Новая вкладка',
        click: () => this.createTab(this.ctx.settings.get('newTabPage') || 'arch://newtab'),
      },
      { type: 'separator' },
      {
        label: 'Положение вкладок',
        submenu: [
          { label: 'Сверху', type: 'radio', checked: position === 'top', click: () => setPosition('top') },
          { label: 'Снизу', type: 'radio', checked: position === 'bottom', click: () => setPosition('bottom') },
          { label: 'Слева (вертикально)', type: 'radio', checked: position === 'left', click: () => setPosition('left') },
          { label: 'Справа (вертикально)', type: 'radio', checked: position === 'right', click: () => setPosition('right') },
        ],
      },
      { type: 'separator' },
      { label: 'Настройки', click: () => this.setUIMode('settings') },
      { label: 'Полноэкранный режим', accelerator: 'F11', click: () => this.toggleBrowserFullscreen() },
    ];
    Menu.buildFromTemplate(items).popup({ window: this._window });
  }

  shareCurrentTab() {
    if (!this._window || this._window.isDestroyed()) return;
    const tab = this.tabs.get(this.activeId);
    if (!tab) return;
    const shareable = /^https?:/i.test(tab.url || '');
    const url = tab.url || '';
    const title = tab.title || this._hostOf(url);
    const encUrl = encodeURIComponent(url);
    const encTitle = encodeURIComponent(title);
    const items = [
      { label: title || 'Страница', enabled: false },
      { type: 'separator' },
      {
        label: 'Копировать ссылку',
        enabled: shareable,
        click: () => {
          clipboard.writeText(url);
          this.sendCommand('toast', { text: 'Ссылка скопирована', type: 'success' });
        },
      },
      {
        label: 'Отправить в Telegram',
        enabled: shareable,
        click: () => shell.openExternal(`https://t.me/share/url?url=${encUrl}&text=${encTitle}`).catch(() => {}),
      },
      {
        label: 'Поделиться ВКонтакте',
        enabled: shareable,
        click: () => shell.openExternal(`https://vk.com/share.php?url=${encUrl}&title=${encTitle}`).catch(() => {}),
      },
      {
        label: 'Отправить по почте',
        enabled: shareable,
        click: () => shell.openExternal(`mailto:?subject=${encTitle}&body=${encUrl}`).catch(() => {}),
      },
      { type: 'separator' },
      {
        label: 'Открыть ссылку в новой вкладке',
        enabled: shareable,
        click: () => this.createTab(url, { active: true }),
      },
    ];
    if (!shareable) {
      items.splice(2, 0, { label: 'У этой страницы нет публичного адреса', enabled: false });
    }
    Menu.buildFromTemplate(items).popup({ window: this._window });
  }

  popupTelegramMenu() {
    if (!this._window || this._window.isDestroyed()) return;
    const items = [
      {
        label: this.telegramOpen ? 'Скрыть Telegram' : 'Открыть Telegram',
        click: () => this.toggleTelegram(),
      },
      { type: 'separator' },
      {
        label: 'Импортировать проверенные прокси…',
        click: async () => {
          this.sendCommand('toast', { text: 'Загружаю свежий список прокси…' });
          try {
            const result = await this.ctx.telegramProxies.importAll({ limit: 200 });
            this.sendCommand('toast', {
              text: `Прокси: ${result.total} в релизе, новых ${result.fresh}, передано в Telegram ${result.opened}`,
              type: result.opened ? 'success' : 'info',
            });
          } catch (err) {
            this.sendCommand('toast', { text: err.message, type: 'error' });
          }
        },
      },
      {
        label: 'Скопировать все ссылки tg://proxy',
        click: async () => {
          try {
            const text = await this.ctx.telegramProxies.copyAll();
            clipboard.writeText(text);
            this.sendCommand('toast', { text: 'Все проверенные прокси скопированы', type: 'success' });
          } catch (err) {
            this.sendCommand('toast', { text: err.message, type: 'error' });
          }
        },
      },
      { type: 'separator' },
      { label: 'Настройки Telegram', click: () => this.setUIMode('settings') },
    ];
    Menu.buildFromTemplate(items).popup({ window: this._window });
  }

  // ---------------- Fullscreen ----------------

  toggleBrowserFullscreen() {
    if (!this._window || this._window.isDestroyed()) return;
    if (this._window.isFullScreen()) this.exitBrowserFullscreen();
    else this._window.setFullScreen(true);
  }

  exitBrowserFullscreen() {
    if (this._window && !this._window.isDestroyed() && this._window.isFullScreen()) {
      this._window.setFullScreen(false);
    }
  }

  _setBrowserFullscreen(on) {
    if (this.destroyed || !this._window || this._window.isDestroyed()) return;
    if (this.browserFullscreen === on) return;
    this.browserFullscreen = on;
    if (on) {
      this._stopFullscreenWatch();
      this._preFullscreenInsets = { ...this.pageInsets };
      // Панели появляются только после 300 мс наведения на верхний или
      // нижний край — как в полноэкранном режиме видео.
      this._fsBarVisible = true;
      this._fsMediaVisible = this._mediaBarVisible;
      this._fsTopEnterAt = 0;
      this._fsMediaEnterAt = 0;
      this._updateVisibility();
      this.layout();
      this.sendCommand('browser-fullscreen', {
        fullscreen: true,
        bar: true,
        media: this._fsMediaVisible,
      });
    } else {
      this._stopFullscreenWatch();
      if (this._preFullscreenInsets) this.pageInsets = { ...this._preFullscreenInsets };
      this._fsBarVisible = false;
      this._fsMediaVisible = false;
      this.sendCommand('browser-fullscreen', { fullscreen: false, bar: false, media: false });
      this._updateVisibility();
      this.layout();
      this._scheduleBroadcast();
    }
  }

  _setFullscreenBar(visible) {
    if (!this.browserFullscreen || this._fsBarVisible === visible) return;
    this._fsBarVisible = visible;
    this.sendCommand('fullscreen-bar', { visible });
    this.layout();
    this._scheduleBroadcast();
  }

  _setFullscreenMedia(visible) {
    if (!this.browserFullscreen || this._fsMediaVisible === visible) return;
    // Если музыка не играет, пульт скрыт — не резервируем под него полосу
    // и не показываем пустую панель.
    if (visible && !this._mediaBarVisible) return;
    this._fsMediaVisible = visible;
    this.sendCommand('fullscreen-media', { visible });
    this.layout();
    this._scheduleBroadcast();
  }

  // Интерфейс сообщает, виден ли пульт (есть локальная музыка или медиа на
  // странице). В полноэкранном режиме по этому флагу решается, показывать ли
  // нижнюю панель.
  setMediaBarVisible(visible) {
    const next = !!visible;
    if (this._mediaBarVisible === next) return;
    this._mediaBarVisible = next;
    if (this.browserFullscreen) this._setFullscreenMedia(next);
    else if (!next && this._fsMediaVisible) this._setFullscreenMedia(false);
  }

  _startFullscreenWatch() {
    this._stopFullscreenWatch();
    const DWELL = 300;
    this._fsWatch = setInterval(() => {
      if (!this.browserFullscreen || !this._window || this._window.isDestroyed()) {
        this._stopFullscreenWatch();
        return;
      }
      try {
        const point = screen.getCursorScreenPoint();
        const bounds = this._window.getBounds();
        const inside = point.x >= bounds.x && point.x <= bounds.x + bounds.width &&
          point.y >= bounds.y && point.y <= bounds.y + bounds.height;
        const now = Date.now();
        // Верхняя полоса: вкладки + панель инструментов.
        const nearTop = inside && point.y <= bounds.y + 78;
        if (nearTop) {
          if (!this._fsTopEnterAt) this._fsTopEnterAt = now;
          if (!this._fsBarVisible && now - this._fsTopEnterAt >= DWELL) {
            this._setFullscreenBar(true);
          }
        } else {
          this._fsTopEnterAt = 0;
          if (this._fsBarVisible && (!inside || point.y > bounds.y + 110)) {
            this._setFullscreenBar(false);
          }
        }
        // Нижний край: мини-плеер.
        const nearBottom = inside && point.y >= bounds.y + bounds.height - 80;
        if (nearBottom) {
          if (!this._fsMediaEnterAt) this._fsMediaEnterAt = now;
          if (!this._fsMediaVisible && now - this._fsMediaEnterAt >= DWELL) {
            this._setFullscreenMedia(true);
          }
        } else {
          this._fsMediaEnterAt = 0;
          if (this._fsMediaVisible && (!inside || point.y < bounds.y + bounds.height - 108)) {
            this._setFullscreenMedia(false);
          }
        }
      } catch {}
    }, 100);
    this._fsWatch.unref?.();
  }

  _stopFullscreenWatch() {
    if (this._fsWatch) {
      clearInterval(this._fsWatch);
      this._fsWatch = null;
    }
    clearTimeout(this._fsHideTimer);
    this._fsHideTimer = null;
    this._fsTopEnterAt = 0;
    this._fsMediaEnterAt = 0;
  }

  setBootOverlay(on) {
    if (this.bootOverlay === !!on) return;
    this.bootOverlay = !!on;
    this._updateVisibility();
    this.layout();
    this._scheduleBroadcast();
  }

  // ---------------- Telegram ----------------

  _createTelegram() {
    if (this.telegram) return;
    const view = new WebContentsView({
      webPreferences: {
        preload: this.ctx.pagePreload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        session: this.ses,
        spellcheck: true,
        backgroundThrottling: false,
        safeDialogs: true,
        additionalArguments: [
          `--arch-fp=${this.ctx.settings.get('fingerprintProtection') ? '1' : '0'}`,
        ],
      },
    });
    const wc = view.webContents;
    this.telegram = { view, wc };
    this._attachView(view, false);

    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) this.createTab(url, { active: true });
      else if (/^(mailto|tel):/i.test(url)) shell.openExternal(url).catch(() => {});
      return { action: 'deny' };
    });

    wc.on('page-title-updated', (_e, title) => {
      const match = /^\((\d+)\)/.exec(String(title || ''));
      this.telegramUnread = match ? Number(match[1]) : 0;
      this._scheduleBroadcast();
    });

    wc.on('context-menu', (_e, params) => {
      const items = [];
      if (params.isEditable) {
        items.push({ label: 'Вырезать', role: 'cut', enabled: params.editFlags.canCut });
        items.push({ label: 'Копировать', role: 'copy', enabled: params.editFlags.canCopy });
        items.push({ label: 'Вставить', role: 'paste', enabled: params.editFlags.canPaste });
        items.push({ type: 'separator' });
        items.push({ label: 'Выделить всё', role: 'selectAll' });
      } else if (params.selectionText) {
        items.push({ label: 'Копировать', role: 'copy' });
      }
      if (!items.length) {
        items.push({ label: 'Обновить', click: () => wc.reload() });
      }
      Menu.buildFromTemplate(items).popup({ window: this._window });
    });

    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      if (input.control && input.key.toLowerCase() === 'l') {
        this.sendCommand('focus-omnibox');
        event.preventDefault();
      } else if (input.key === 'Escape') {
        this.sendCommand('escape');
      }
    });

    wc.loadURL('https://web.telegram.org/a/').catch((err) => {
      console.error('[telegram] load failed:', err.message);
    });
  }

  toggleTelegram(force) {
    const open =
      typeof force === 'boolean'
        ? force
        : !(this.telegramOpen && this.uiMode === 'web');
    if (open) this.openTelegram();
    else this.closeTelegram();
  }

  openTelegram() {
    this._createTelegram();
    if (this.telegramOpen && this.uiMode === 'web') {
      try {
        this.telegram.wc.focus();
      } catch {}
      return;
    }
    this.telegramOpen = true;
    this.uiMode = 'web';
    this.sendCommand('close-dock');
    this._updateVisibility();
    this._animateTelegram(this.telegramWidth);
    this._scheduleBroadcast();
    setTimeout(() => {
      if (this.telegramOpen && this.telegram && !this.telegram.wc.isDestroyed()) {
        this.telegram.wc.focus();
      }
    }, 200);
  }

  closeTelegram() {
    if (!this.telegramOpen) return;
    this.telegramOpen = false;
    this._animateTelegram(0, () => {
      if (this.telegram) this._attachView(this.telegram.view, false);
    });
    if (this.uiMode === 'web') {
      const tab = this.tabs.get(this.activeId);
      if (tab) {
        try {
          tab.wc.focus();
        } catch {}
      }
    }
    this._scheduleBroadcast();
  }

  _animateTelegram(target, done) {
    if (this._telegramAnim) {
      clearInterval(this._telegramAnim);
      this._telegramAnim = null;
    }
    const start = this._telegramCurrentWidth;
    const started = Date.now();
    const duration = 190;
    const tick = () => {
      const progress = Math.min(1, (Date.now() - started) / duration);
      const eased = 1 - (1 - progress) ** 3;
      this._telegramCurrentWidth = start + (target - start) * eased;
      this.layout();
      if (progress >= 1) {
        clearInterval(this._telegramAnim);
        this._telegramAnim = null;
        this._telegramCurrentWidth = target;
        this.layout();
        if (done) done();
      }
    };
    this._telegramAnim = setInterval(tick, 16);
    tick();
  }

  _telegramVisibleWidth() {
    if (!this.telegramOpen || this.uiMode !== 'web' || this.htmlFullscreen || this.browserFullscreen) return 0;
    return Math.max(0, Math.round(this._telegramCurrentWidth));
  }

  selectTab(id, { keepPanel = false } = {}) {
    if (!this.tabs.has(id)) return;
    const targetTab = this.tabs.get(id);
    this.activeId = id;
    this.uiMode = targetTab.service || 'web';
    this._updateVisibility();
    this.layout();
    try {
      if (targetTab.service) this._window.webContents.focus();
      else targetTab.wc.focus();
    } catch {}
    this._setWindowTitle();
    this._scheduleBroadcast();
  }

  // Служебные разделы (настройки, плеер, torrent) живут в одной
  // переиспользуемой вкладке каждый: повторный вызов переключает на неё,
  // а не создаёт новую.
  openServiceTab(mode) {
    if (!SERVICE_TITLES[mode]) return null;
    const idField = SERVICE_FIELDS[mode];
    if (!idField) return null;
    let tab = this[idField] ? this.tabs.get(this[idField]) : null;
    if (!tab) {
      this[idField] = null;
      tab = this.createTab(`arch://${mode}`, { active: false });
      if (!tab) return null;
      this[idField] = tab.id;
    }
    tab.service = mode;
    tab.isSettings = mode === 'settings';
    tab.title = SERVICE_TITLES[mode];
    tab.url = `arch://${mode}`;
    this.activeId = tab.id;
    this.uiMode = mode;
    this._updateVisibility();
    this.layout();
    try {
      this._window.webContents.focus();
    } catch {}
    this._setWindowTitle();
    this._scheduleBroadcast();
    return tab.id;
  }

  openSettingsTab() {
    return this.openServiceTab('settings');
  }

  closeSettingsTab() {
    if (!this.settingsTabId) {
      this.setUIMode('web');
      return;
    }
    this.closeTab(this.settingsTabId);
  }

  // Magnet-ссылка: спрашиваем папку и отдаём её BitTorrent-клиенту.
  async openMagnet(magnet) {
    try {
      const res = await dialog.showOpenDialog(this._window, {
        title: 'Куда сохранять торрент?',
        buttonLabel: 'Сохранять сюда',
        defaultPath: this.ctx.settings.get('torrentDir') || this.ctx.settings.get('downloadDir') || undefined,
        properties: ['openDirectory', 'createDirectory'],
      });
      if (res.canceled || !res.filePaths.length) return;
      this.ctx.settings.set({ torrentDir: res.filePaths[0] });
      await this.ctx.torrentService.add(
        { kind: 'magnet', value: magnet },
        { dir: res.filePaths[0] },
      );
      this.sendCommand('toast', { text: 'Загрузка добавлена в BitTorrent-клиент', type: 'success' });
      this.setUIMode('torrent');
    } catch (err) {
      this.sendCommand('toast', { text: `Ошибка: ${err.message}`, type: 'error' });
    }
  }

  navigate(input) {
    const tab = this.tabs.get(this.activeId);
    if (!tab) return;
    let target = this.normalizeInput(input);
    if (!target) return;
    // Magnet-ссылки открываются в BitTorrent-клиенте.
    if (/^magnet:/i.test(target)) {
      this.openMagnet(target);
      return;
    }
    const serviceMatch = /^arch:\/\/(settings|player|torrent|vpn|extensions|downloads|history|bookmarks|about)\/?$/i.exec(target);
    if (serviceMatch) {
      this.openServiceTab(serviceMatch[1].toLowerCase());
      return;
    }
    if (this._importProxyLink(target)) return;
    if (tab.service) {
      // Уход со служебной вкладки превращает её в обычную.
      for (const field of Object.values(SERVICE_FIELDS)) {
        if (tab.id === this[field]) this[field] = null;
      }
      tab.service = null;
      tab.isSettings = false;
    }
    if (this.ctx.settings.get('stripTrackingParams')) target = cleanTrackingParams(target);
    tab.errorPage = false;
    tab.proxyRetryUrl = '';
    this.uiMode = 'web';
    this._updateVisibility();
    this.layout();
    tab.wc.loadURL(target).catch((err) => {
      if (tab.errorPage || /ERR_ABORTED/i.test(String(err && err.message))) return;
      tab.error = err.message;
      this._scheduleBroadcast();
    });
    this._scheduleBroadcast();
  }

  // Ссылка вида vless://… из адресной строки или со страницы сразу добавляется в VPN.
  _importProxyLink(target) {
    if (!/^(vless|vmess|trojan|ss):\/\//i.test(target)) return false;
    const result = this.ctx.vpn.addFromText(target);
    if (result.added) {
      const name = result.servers[0] ? result.servers[0].name : 'сервер';
      this.sendCommand('toast', { text: `Сервер добавлен: ${name}`, type: 'success' });
      this.setUIMode('vpn');
    } else {
      this.sendCommand('toast', {
        text: (result.errors && result.errors[0]) || 'Не удалось добавить сервер',
        type: 'error',
      });
    }
    return true;
  }

  normalizeInput(input) {
    const s = String(input || '').trim();
    if (!s) return null;
    if (/^magnet:/i.test(s)) return s;
    if (/^(https?|file|arch|about):/i.test(s)) return s;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;

    const looksHost =
      /^[\w.-]+\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(s) ||
      /^localhost(:\d+)?([/?#].*)?$/i.test(s) ||
      /^\d{1,3}(\.\d{1,3}){3}(:\d+)?([/?#].*)?$/.test(s) ||
      /^\[[0-9a-f:]+\](:\d+)?([/?#].*)?$/i.test(s);

    if (looksHost && !s.includes(' ')) return 'https://' + s;
    return this.ctx.settings.searchUrl(s);
  }

  goBack() {
    const tab = this.tabs.get(this.activeId);
    if (!tab) return;
    try {
      if (tab.wc.navigationHistory.canGoBack()) tab.wc.navigationHistory.goBack();
    } catch {}
  }

  goForward() {
    const tab = this.tabs.get(this.activeId);
    if (!tab) return;
    try {
      if (tab.wc.navigationHistory.canGoForward()) tab.wc.navigationHistory.goForward();
    } catch {}
  }

  reload() {
    const tab = this.tabs.get(this.activeId);
    if (!tab) return;
    // Со страницы ошибки «Обновить» перезагружает исходный адрес, а не её саму.
    if (tab.errorPage && /^https?:/i.test(tab.url || '')) {
      tab.errorPage = false;
      tab.proxyRetryUrl = '';
      tab.wc.loadURL(tab.url).catch(() => {});
      return;
    }
    tab.wc.reload();
  }

  reloadHard() {
    const tab = this.tabs.get(this.activeId);
    if (!tab) return;
    if (tab.errorPage && /^https?:/i.test(tab.url || '')) {
      tab.errorPage = false;
      tab.proxyRetryUrl = '';
      tab.wc.loadURL(tab.url).catch(() => {});
      return;
    }
    tab.wc.reloadIgnoringCache();
  }

  stop() {
    const tab = this.tabs.get(this.activeId);
    if (tab) tab.wc.stop();
  }

  zoom(delta) {
    const tab = this.tabs.get(this.activeId);
    if (!tab) return;
    if (delta === 0) {
      tab.wc.setZoomFactor(1);
      return;
    }
    const next = Math.min(5, Math.max(0.25, tab.wc.getZoomFactor() + delta));
    tab.wc.setZoomFactor(next);
    this._scheduleBroadcast();
  }

  // На внутренней стартовой странице инструменты разработчика отключены.
  _devToolsBlocked() {
    const tab = this.tabs.get(this.activeId);
    if (!tab) return false;
    try {
      return String(tab.wc.getURL() || tab.url || '').startsWith('arch://');
    } catch {
      return false;
    }
  }

  toggleDevTools() {
    const tab = this.tabs.get(this.activeId);
    if (!tab) return;
    if (this._devToolsBlocked()) {
      try { if (tab.wc.isDevToolsOpened()) tab.wc.closeDevTools(); } catch {}
      return;
    }
    if (tab.wc.isDevToolsOpened()) tab.wc.closeDevTools();
    else tab.wc.openDevTools({ mode: 'detach' });
  }

  find(text, { forward = true, findNext = false } = {}) {
    const tab = this.tabs.get(this.activeId);
    if (!tab) return;
    if (!text) {
      tab.wc.stopFindInPage('clearSelection');
      this._lastFind = '';
      return;
    }
    this._lastFind = text;
    tab.wc.findInPage(text, { forward, findNext });
  }

  stopFind() {
    const tab = this.tabs.get(this.activeId);
    if (!tab) return;
    tab.wc.stopFindInPage('clearSelection');
    this._lastFind = '';
  }

  mute() {
    const tab = this.tabs.get(this.activeId);
    if (!tab) return;
    tab.wc.setAudioMuted(!tab.wc.isAudioMuted());
    this._scheduleBroadcast();
  }

  focusPage() {
    const tab = this.tabs.get(this.activeId);
    if (!tab) return;
    try {
      tab.wc.focus();
    } catch {}
  }

  toggleBookmark() {
    const tab = this.tabs.get(this.activeId);
    if (!tab || !/^https?:/i.test(tab.url)) {
      return { added: false, error: 'Эту страницу нельзя добавить в закладки' };
    }
    const result = this.ctx.bookmarks.toggle({ url: tab.url, title: tab.title });
    this._scheduleBroadcast();
    return result;
  }

  setUIMode(mode) {
    if (!['web', 'settings', 'vpn', 'extensions', 'history', 'bookmarks', 'downloads',
      'player', 'torrent', 'about'].includes(mode)) {
      mode = 'web';
    }
    // Все разделы интерфейса — не оверлеи, а отдельные переиспользуемые
    // вкладки. Повторный вызов переключает на уже открытую вкладку.
    if (SERVICE_FIELDS[mode]) {
      return this.openServiceTab(mode);
    }
    // Служебная вкладка: если из неё нужно вернуться к обычному просмотру,
    // переключаемся на ближайшую обычную вкладку.
    if (mode === 'web') {
      const active = this.tabs.get(this.activeId);
      if (active && active.service) {
        const normal = [...this.order].reverse()
          .map((id) => this.tabs.get(id))
          .find((tab) => tab && !tab.service);
        if (normal) {
          this.activeId = normal.id;
          try {
            normal.wc.focus();
          } catch {}
        } else {
          const created = this.createTab(this.ctx.settings.get('newTabPage') || 'arch://newtab');
          if (created) this.activeId = created.id;
        }
      }
    }
    this.uiMode = mode;
    this._updateVisibility();
    this.layout();
    this._scheduleBroadcast();
    return null;
  }

  _updateVisibility() {
    const overlayOpen = (this._overlayHolds || 0) > 0;
    for (const [id, tab] of this.tabs) {
      try {
        const visible = !this.bootOverlay &&
          !overlayOpen &&
          this.uiMode === 'web' &&
          id === this.activeId;
        this._attachView(tab.view, visible);
      } catch {}
    }
    if (this.telegram) {
      try {
        this._attachView(
          this.telegram.view,
          this.telegramOpen &&
            !overlayOpen &&
            this.uiMode === 'web' &&
            !this.htmlFullscreen &&
            !this.browserFullscreen &&
            !this.bootOverlay &&
            this._telegramCurrentWidth > 8,
        );
      } catch {}
    }
  }

  // Пока открыт диалог/меню поверх страницы, нативный WebContentsView
  // перекрывает слой интерфейса. На время диалога убираем страницу из дерева
  // и возвращаем её после закрытия.
  setOverlay(open) {
    const next = Math.max(0, (this._overlayHolds || 0) + (open ? 1 : -1));
    if (next === this._overlayHolds) return;
    this._overlayHolds = next;
    this._updateVisibility();
  }

  // Контекстные меню строит главный процесс: нативное меню всегда рисуется
  // поверх нативной страницы, в отличие от HTML-меню.
  popupContextMenu(spec = {}) {
    if (!this._window || this._window.isDestroyed()) return Promise.resolve(null);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const build = (items) => (Array.isArray(items) ? items : []).flatMap((item) => {
        if (!item || item.sep || item.type === 'separator') return [{ type: 'separator' }];
        const row = {
          label: String(item.label || ''),
          enabled: item.enabled !== false,
        };
        if (item.role) row.role = item.role;
        else if (Array.isArray(item.submenu)) row.submenu = build(item.submenu);
        else if (item.id != null) row.click = () => finish(item.id);
        if (item.accelerator) row.accelerator = item.accelerator;
        return [row];
      });
      try {
        Menu.buildFromTemplate(build(spec.items)).popup({
          window: this._window,
          x: Number.isFinite(spec.x) ? Math.round(spec.x) : undefined,
          y: Number.isFinite(spec.y) ? Math.round(spec.y) : undefined,
          callback: () => setTimeout(() => finish(null), 0),
        });
      } catch {
        finish(null);
      }
    });
  }

  // В этой версии Electron WebContentsView.setVisible() не скрывает страницу:
  // view остаётся в дереве и перекрывает и активную вкладку, и панели браузера.
  // Поэтому видимостью управляем через addChildView/removeChildView.
  _attachView(view, visible) {
    if (!view || this.destroyed || !this._window || this._window.isDestroyed()) return;
    const want = !!visible;
    if (view.__archAttached === want) return;
    const cv = this._window.contentView;
    try {
      if (want) {
        cv.addChildView(view);
        view.__archAttached = true;
      } else {
        cv.removeChildView(view);
        view.__archAttached = false;
      }
    } catch {}
  }

  setChromeHeight(height) {
    this.setPageInsets({ ...this.pageInsets, top: height });
  }

  setPageInsets(insets = {}) {
    if (this.destroyed || !this._window || this._window.isDestroyed()) return;
    const [width, height] = this._window.getContentSize();
    const num = (value, fallback) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback;
    };
    const next = {
      top: Math.min(height, num(insets.top, this.pageInsets.top)),
      left: Math.min(width, num(insets.left, 0)),
      right: Math.min(width, num(insets.right, 0)),
      bottom: Math.min(height, num(insets.bottom, 0)),
    };
    if (next.left + next.right > width - 120) {
      next.left = 0;
      next.right = 0;
    }
    if (next.top + next.bottom > height - 120) {
      next.top = 0;
      next.bottom = 0;
    }
    const changed =
      next.top !== this.pageInsets.top ||
      next.left !== this.pageInsets.left ||
      next.right !== this.pageInsets.right ||
      next.bottom !== this.pageInsets.bottom;
    this.pageInsets = next;
    this.chromeHeight = next.top;
    this.layout();
    if (changed) this._scheduleBroadcast();
  }

  layout() {
    if (this.destroyed || !this._window || this._window.isDestroyed()) return;
    const [width, height] = this._window.getContentSize();
    const insets = this.htmlFullscreen
      ? { top: 0, left: 0, right: 0, bottom: 0 }
      : this.pageInsets;
    const left = insets.left;
    const top = insets.top;
    const contentWidth = Math.max(0, width - left - insets.right);
    const contentHeight = Math.max(0, height - top - insets.bottom);
    const panelWidth = this._telegramVisibleWidth();
    const pageWidth = Math.max(0, contentWidth - panelWidth);

    for (const [id, tab] of this.tabs) {
      const bounds = { x: left, y: top, width: pageWidth, height: contentHeight };
      try {
        tab.view.setBounds(bounds);
        // Страница показывается только в обычном режиме: когда открыта панель
        // настроек (или другой раздел), она не должна закрывать её собой.
        this._attachView(
          tab.view,
          this.uiMode === 'web' && !this.bootOverlay && id === this.activeId,
        );
      } catch {}
    }

    if (this.telegram) {
      try {
        this.telegram.view.setBounds({
          x: left + pageWidth,
          y: top,
          width: panelWidth,
          height: contentHeight,
        });
        this._attachView(
          this.telegram.view,
          this.telegramOpen &&
            this.uiMode === 'web' &&
            !this.htmlFullscreen &&
            !this.browserFullscreen &&
            !this.bootOverlay &&
            panelWidth > 8,
        );
      } catch {}
    }
  }

  _setWindowTitle() {
    if (!this._window || this._window.isDestroyed()) return;
    const tab = this.tabs.get(this.activeId);
    const title = tab && tab.title ? tab.title : 'ArchBrowser';
    this._window.setTitle(`${this.isPrivate ? '🕶 ' : ''}${title} — ArchBrowser`);
  }

  applyTheme(theme) {
    if (this.destroyed || !theme) return;
    if (this._window && !this._window.isDestroyed()) {
      if (process.platform !== 'darwin') {
        try {
          this._window.setTitleBarOverlay({
            color: theme.overlayColor,
            symbolColor: theme.overlaySymbol,
            height: 40,
          });
        } catch {}
      }
      try {
        this._window.setBackgroundColor(theme.background);
      } catch {}
    }
    for (const tab of this.tabs.values()) {
      try {
        tab.wc.send('arch-theme', theme);
      } catch {}
    }
  }

  // Сообщение только страницам новой вкладки (arch://newtab).
  sendToNewTabs(channel, payload) {
    for (const tab of this.tabs.values()) {
      try {
        if (String(tab.wc.getURL() || '').startsWith('arch://newtab')) {
          tab.wc.send(channel, payload);
        }
      } catch {}
    }
  }

  _hostOf(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  }

  // ---------------- Загрузка: полоска прогресса, таймаут, страница ошибки ----------------

  _startTabProgress(tab) {
    this._stopTabProgress(tab);
    tab.progress = 0.06;
    tab.progressTimer = setInterval(() => {
      if (!tab.progress) return;
      const left = 0.9 - tab.progress;
      if (left <= 0.005) return;
      tab.progress = Math.min(0.9, tab.progress + Math.max(0.006, left * 0.07));
      this._scheduleBroadcast();
    }, 220);
    tab.progressTimer.unref?.();
  }

  _stopTabProgress(tab) {
    if (tab.progressTimer) {
      clearInterval(tab.progressTimer);
      tab.progressTimer = null;
    }
    tab.progress = 0;
  }

  _finishTabProgress(tab) {
    if (tab.progressTimer) {
      clearInterval(tab.progressTimer);
      tab.progressTimer = null;
    }
    if (tab.progress >= 0.06) {
      tab.progress = 1;
      this._scheduleBroadcast();
      const id = tab.id;
      setTimeout(() => {
        const t = this.tabs.get(id);
        if (!t || t.progress !== 1) return;
        t.progress = 0;
        this._scheduleBroadcast();
      }, 450);
    }
  }

  // 30 секунд без ответа — показываем страницу «сайт не отвечает».
  _startLoadWatch(tab, url) {
    this._clearLoadWatch(tab);
    if (!/^https?:/i.test(String(url || ''))) return;
    tab.watchUrl = url;
    tab.loadTimer = setTimeout(() => {
      tab.loadTimer = null;
      if (this.destroyed || tab.wc.isDestroyed() || !this.tabs.has(tab.id)) return;
      if (!tab.loading || tab.watchUrl !== url) return;
      console.warn('[tab] нет ответа за 30 с:', url);
      this._showErrorPage(tab, { kind: 'timeout', url });
    }, 30000);
    tab.loadTimer.unref?.();
  }

  _clearLoadWatch(tab) {
    if (tab.loadTimer) {
      clearTimeout(tab.loadTimer);
      tab.loadTimer = null;
    }
    tab.watchUrl = '';
  }

  // Антибот-заставка Cloudflare / DDoS-Guard. В обычном Chrome проверка
  // проходится сама, а Chromium внутри Electron антибот-системы часто
  // отправляют на бесконечную проверку. Подсказываем выход пользователю.
  _watchChallenge(tab) {
    if (!tab || this.destroyed || tab.errorPage) return;
    if (!/^https?:/i.test(String(tab.url || ''))) return;
    if (tab.challengeTimer) clearTimeout(tab.challengeTimer);
    tab.challengeTimer = setTimeout(async () => {
      tab.challengeTimer = null;
      if (this.destroyed || !tab.wc || tab.wc.isDestroyed() || !this.tabs.has(tab.id)) return;
      let info = null;
      try {
        info = await tab.wc.executeJavaScript(
          `(() => { const b = document.body ? document.body.innerText : ''; return { t: document.title || '', b: String(b).slice(0, 600), h: location.hostname }; })()`,
        );
      } catch {
        return;
      }
      if (!info) return;
      const body = String(info.b || '');
      const text = `${info.t} ${body}`;
      // Признаки антибот-заставки. Дополнительно требуем короткую страницу,
      // чтобы не срабатывать на статьях про безопасность.
      const marker = /Один момент|Just a moment|Checking your browser|Выполнение проверки|Проверка безопасности|DDoS-Guard|Attention Required|Доступ ограничен|Verifying you are human|Checking if the site connection is secure/i;
      if (body.length > 1400 || !marker.test(text)) return;
      const host = info.h || this._hostOf(tab.url);
      if (!this._challengeSeen) this._challengeSeen = new Map();
      const now = Date.now();
      if (now - (this._challengeSeen.get(host) || 0) < 10 * 60 * 1000) return;
      this._challengeSeen.set(host, now);

      const target = tab.url;
      let res = null;
      try {
        res = await dialog.showMessageBox(this.win, {
          type: 'warning',
          title: 'Нужна проверка браузера',
          message: `${host}: сайт проверяет, что вы не робот`,
          detail:
            'Проверка Cloudflare / DDoS-Guard не проходится в этом браузере — так бывает при подключении через VPN.\n\n' +
            'Можно открыть страницу в браузере по умолчанию (там проверка обычно проходит), повторить загрузку ' +
            'или сменить VPN-сервер.',
          buttons: ['Открыть в браузере', 'Повторить', 'Закрыть'],
          defaultId: 0,
          cancelId: 2,
          noLink: true,
        });
      } catch {
        res = null;
      }
      if (!res) return;
      if (res.response === 0) shell.openExternal(target).catch(() => {});
      else if (res.response === 1 && tab.wc && !tab.wc.isDestroyed()) tab.wc.reload();
    }, 6000);
    tab.challengeTimer.unref?.();
  }

  _showErrorPage(tab, { kind = 'net', url = '', code = 0, desc = '' } = {}) {
    if (!tab || this.destroyed || !tab.wc || tab.wc.isDestroyed()) return;
    this._clearLoadWatch(tab);
    this._stopTabProgress(tab);
    tab.loading = false;
    tab.errorPage = true;
    tab.error = kind === 'timeout' ? 'Страница не отвечает' : desc || 'Не удалось загрузить страницу';
    if (!tab.title || tab.title === 'Новая вкладка') tab.title = this._hostOf(url) || tab.title;
    const params = new URLSearchParams({
      kind: String(kind),
      url: String(url || ''),
      code: String(code || ''),
      desc: String(desc || ''),
    });
    tab.wc.loadURL(`arch://error?${params.toString()}`).catch(() => {});
    this._setWindowTitle();
    this._scheduleBroadcast();
  }

  // Кнопка «Открыть через VPN» на странице ошибки и повтор после сбоя.
  async retryThroughVpn(url) {
    const target = String(url || '');
    if (!/^https?:/i.test(target)) return false;
    try {
      await this.ctx.vpn.markDirectFailure(target, { force: true });
    } catch {}
    let tab = null;
    for (const candidate of this.tabs.values()) {
      if (candidate.errorPage) {
        tab = candidate;
        break;
      }
    }
    if (!tab) tab = this.tabs.get(this.activeId);
    if (!tab || tab.wc.isDestroyed()) return false;
    tab.errorPage = false;
    tab.proxyRetryUrl = target;
    tab.error = null;
    tab.wc.loadURL(target).catch(() => {});
    this._scheduleBroadcast();
    return true;
  }

  _showContextMenu(tab, params) {
    const items = [];
    const send = (action) => this.sendCommand(action);

    if (params.linkURL) {
      items.push({
        label: 'Открыть ссылку в новой вкладке',
        click: () => this.createTab(cleanTrackingParams(params.linkURL), { active: true }),
      });
      items.push({
        label: 'Копировать адрес ссылки',
        click: () => clipboard.writeText(params.linkURL),
      });
      items.push({ type: 'separator' });
    }

    if (params.mediaType === 'image' && params.srcURL) {
      items.push({
        label: 'Открыть изображение в новой вкладке',
        click: () => this.createTab(params.srcURL, { active: true }),
      });
      items.push({
        label: 'Копировать адрес изображения',
        click: () => clipboard.writeText(params.srcURL),
      });
      items.push({
        label: 'Сохранить изображение как…',
        click: () => tab.wc.downloadURL(params.srcURL),
      });
      items.push({ type: 'separator' });
    }

    if (params.isEditable) {
      items.push({ role: 'undo', label: 'Отменить' });
      items.push({ role: 'redo', label: 'Повторить' });
      items.push({ type: 'separator' });
      items.push({ role: 'cut', label: 'Вырезать' });
      items.push({ role: 'copy', label: 'Копировать' });
      items.push({ role: 'paste', label: 'Вставить' });
      items.push({ role: 'selectAll', label: 'Выделить всё' });
      items.push({ type: 'separator' });
    } else if (params.selectionText) {
      items.push({ role: 'copy', label: 'Копировать' });
      items.push({
        label: 'Искать в интернете',
        click: () => this.createTab(this.ctx.settings.searchUrl(params.selectionText), { active: true }),
      });
      items.push({ type: 'separator' });
    }

    const canBack = (() => { try { return tab.wc.navigationHistory.canGoBack(); } catch { return false; } })();
    const canForward = (() => { try { return tab.wc.navigationHistory.canGoForward(); } catch { return false; } })();

    items.push({ label: 'Назад', enabled: canBack, click: () => this.goBack() });
    items.push({ label: 'Вперёд', enabled: canForward, click: () => this.goForward() });
    items.push({ label: 'Обновить', click: () => this.reload() });
    items.push({ type: 'separator' });
    // На внутренних страницах (arch://) пункт «Проверить элемент» убираем.
    if (!this._devToolsBlocked()) {
      items.push({
        label: 'Проверить элемент',
        click: () => tab.wc.inspectElement(params.x, params.y),
      });
    }

    Menu.buildFromTemplate(items).popup({ window: this._window });
  }

  // ---------------- Подсказки адресной строки ----------------
  // Выпадающий список показывается отдельным окном поверх страницы: основная
  // панель браузера не сдвигается, как в других браузерах.
  _createSuggestions() {
    if (this._suggestions && !this._suggestions.isDestroyed()) return this._suggestions;
    const popup = new BrowserWindow({
      width: 520,
      height: 200,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      transparent: true,
      backgroundColor: '#00000000',
      parent: this._window,
      webPreferences: {
        preload: path.join(__dirname, 'preload-suggest.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // Окно подсказок не должно забирать фокус клавиатуры у адресной строки.
        focusable: false,
      },
    });
    this._suggestions = popup;
    popup.setMenuBarVisibility(false);
    popup.setAlwaysOnTop(true, 'floating');
    popup.loadFile(path.join(__dirname, 'ui', 'suggestions.html'));
    popup.on('blur', () => {
      try {
        popup.hide();
      } catch {}
    });
    popup.on('closed', () => {
      this._suggestions = null;
    });
    return popup;
  }

  async showSuggestions(html, rect) {
    const popup = this._createSuggestions();
    const win = this._window;
    if (!win || win.isDestroyed()) return;
    const zoom = win.webContents.getZoomFactor() || 1;
    const bounds = win.getContentBounds();
    const x = bounds.x + Math.round((rect.x || 0) * zoom);
    const y = bounds.y + Math.round((rect.y || 0) * zoom);
    const width = Math.max(280, Math.round((rect.width || 520) * zoom));
    popup.setBounds({ x, y, width, height: 240 });
    popup.webContents.send('suggestions:html', html);
    // Окно показываем после того, как содержимое измерено. Фокус клавиатуры
    // остаётся в адресной строке — иначе ввод в неё сбивается.
    await new Promise((resolve) => setTimeout(resolve, 90));
    if (!popup.isDestroyed()) {
      popup.showInactive();
    }
  }

  resizeSuggestions(height) {
    const popup = this._suggestions;
    if (!popup || popup.isDestroyed()) return;
    const bounds = popup.getBounds();
    const heightPx = Math.max(80, Math.min(460, Math.ceil(height) + 2));
    if (Math.abs(bounds.height - heightPx) < 2) return;
    popup.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: heightPx });
  }

  hideSuggestions() {
    const popup = this._suggestions;
    if (!popup || popup.isDestroyed()) return;
    try {
      popup.hide();
    } catch {}
  }

  // ---------------- Уведомления поверх страницы ----------------
  // Страницы рисуются нативным слоем ПОВЕРХ HTML основного окна, поэтому
  // обычный div.toast всегда оказывался под сайтом. Показываем сообщения
  // отдельным окном, как подсказки адресной строки.
  _createToastWindow() {
    if (this._toastWin && !this._toastWin.isDestroyed()) return this._toastWin;
    const popup = new BrowserWindow({
      width: 520,
      height: 96,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      parent: this._window,
      webPreferences: {
        preload: path.join(__dirname, 'preload-toast.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // Уведомление не должно перехватывать фокус клавиатуры.
        focusable: false,
      },
    });
    this._toastWin = popup;
    popup.setMenuBarVisibility(false);
    popup.setAlwaysOnTop(true, 'floating');
    // Клики проходят сквозь уведомление на страницу.
    popup.setIgnoreMouseEvents(true);
    popup.loadFile(path.join(__dirname, 'ui', 'toast.html'));
    popup.on('closed', () => {
      this._toastWin = null;
      if (this._toastTimer) {
        clearTimeout(this._toastTimer);
        this._toastTimer = null;
      }
    });
    return popup;
  }

  _positionToast() {
    const win = this._window;
    const popup = this._toastWin;
    if (!win || win.isDestroyed() || !popup || popup.isDestroyed()) return;
    const bounds = win.getContentBounds();
    const zoom = win.webContents.getZoomFactor() || 1;
    const width = Math.min(640, Math.max(320, Math.round(540 * zoom)));
    const height = Math.max(64, Math.round(96 * zoom));
    const x = bounds.x + Math.round((bounds.width - width) / 2);
    const y = bounds.y + bounds.height - height - Math.round(34 * zoom);
    popup.setBounds({ x, y, width, height });
  }

  _repositionToast() {
    const popup = this._toastWin;
    if (!popup || popup.isDestroyed() || !popup.isVisible()) return;
    this._positionToast();
  }

  showToast(message, type = 'info') {
    const text = String(message == null ? '' : message).trim();
    if (!text) return;
    const popup = this._createToastWindow();
    this._positionToast();
    if (this._toastTimer) {
      clearTimeout(this._toastTimer);
      this._toastTimer = null;
    }
    const send = () => {
      if (popup.isDestroyed()) return;
      popup.webContents.send('toast:data', { message: text, type });
      // Прозрачное окно иногда остаётся невидимым до первой отрисовки —
      // показываем ещё раз, когда содержимое готово.
      try {
        popup.showInactive();
      } catch {}
    };
    if (popup.webContents.isLoading()) popup.webContents.once('did-finish-load', send);
    else send();
    popup.showInactive();
    this._toastTimer = setTimeout(() => this.hideToast(), type === 'error' ? 6500 : 3500);
    this._toastTimer.unref?.();
  }

  hideToast() {
    if (this._toastTimer) {
      clearTimeout(this._toastTimer);
      this._toastTimer = null;
    }
    const popup = this._toastWin;
    if (!popup || popup.isDestroyed()) return;
    try {
      popup.hide();
    } catch {}
  }

  // ---------------- State ----------------

  // Стартовая страница сообщает состояние таймера и будильника — индикатор
  // появляется в панели инструментов перед кнопкой VPN.
  setTimerState(state = {}) {
    this.timerState = {
      running: !!state.running,
      left: Number(state.left) || 0,
      label: typeof state.label === 'string' ? state.label : '',
      alarm: typeof state.alarm === 'string' ? state.alarm : '',
    };
    this._scheduleBroadcast();
  }

  ownsWebContents(wc) {
    if (!wc) return false;
    for (const tab of this.tabs.values()) {
      if (tab.wc === wc) return true;
    }
    return false;
  }

  snapshot() {
    const vpn = this.ctx.vpn.status();
    const settings = this.ctx.settings;
    return {
      windowId: this.id,
      isPrivate: this.isPrivate,
      activeTabId: this.activeId,
      uiMode: this.uiMode,
      chromeHeight: this.chromeHeight,
      browserFullscreen: this.browserFullscreen,
      fullscreenBar: this._fsBarVisible,
      fullscreenMedia: this._fsMediaVisible,
      bootOverlay: this.bootOverlay,
      telegramOpen: this.telegramOpen,
      telegramUnread: this.telegramUnread,
      tabs: this.order.map((id) => {
        const tab = this.tabs.get(id);
        let canBack = false;
        let canForward = false;
        try {
          canBack = tab.wc.navigationHistory.canGoBack();
          canForward = tab.wc.navigationHistory.canGoForward();
        } catch {}
        return {
          id: tab.id,
          title: tab.title,
          url: tab.url,
          favicon: tab.favicon,
          loading: tab.loading,
          progress: tab.progress || 0,
          error: tab.error,
          isSettings: !!tab.isSettings,
          service: tab.service || null,
          audible: tab.audible,
          blocked: this.ctx.privacy.getBlocked(tab.wc.id),
          canBack,
          canForward,
          bookmarked: this.ctx.bookmarks.has(tab.url),
        };
      }),
      activeTab: (() => {
        const tab = this.tabs.get(this.activeId);
        if (!tab) return null;
        return {
          id: tab.id,
          url: tab.url,
          title: tab.title,
          error: tab.error,
          service: tab.service || null,
          zoom: tab.wc.getZoomFactor ? tab.wc.getZoomFactor() : 1,
          bookmarked: this.ctx.bookmarks.has(tab.url),
          muted: tab.wc.isAudioMuted ? tab.wc.isAudioMuted() : false,
        };
      })(),
      vpn,
      timer: this.timerState,
      player: {
        page: this.ctx.playerService ? this.ctx.playerService.pageState : { active: false },
      },
      passwords: {
        locked: this.ctx.passwords.isLocked(),
        hasMaster: this.ctx.passwords.hasMaster(),
      },
      settings: settings.all,
      downloads: this.ctx.downloads.slice(0, 30),
      extensions: this.ctx.extensions.list(),
      privacyStats: this.ctx.privacy.getStats(this.tabs.get(this.activeId)?.wc.id),
      theme: this.ctx.theme ? this.ctx.theme() : null,
      version: {
        app: this.ctx.appVersion,
        chrome: this.ctx.chromeVersion,
        electron: process.versions.electron,
      },
    };
  }

  _scheduleBroadcast() {
    if (this._bTimer || this.destroyed) return;
    this._bTimer = setTimeout(() => {
      this._bTimer = null;
      this.broadcast();
    }, 40);
  }

  broadcast() {
    if (this.destroyed || !this._window || this._window.isDestroyed()) return;
    try {
      this._window.webContents.send('state', this.snapshot());
    } catch {}
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this._stopFullscreenWatch();
    if (this._telegramAnim) {
      clearInterval(this._telegramAnim);
      this._telegramAnim = null;
    }
    if (this.telegram) {
      try {
        this._window.contentView.removeChildView(this.telegram.view);
        if (!this.telegram.wc.isDestroyed()) this.telegram.wc.close();
      } catch {}
      this.telegram = null;
    }
    if (this._toastTimer) {
      clearTimeout(this._toastTimer);
      this._toastTimer = null;
    }
    for (const popup of [this._toastWin, this._suggestions]) {
      if (popup && !popup.isDestroyed()) {
        try {
          popup.destroy();
        } catch {}
      }
    }
    this._toastWin = null;
    this._suggestions = null;
    for (const tab of this.tabs.values()) {
      this._clearLoadWatch(tab);
      if (tab.progressTimer) {
        clearInterval(tab.progressTimer);
        tab.progressTimer = null;
      }
      try {
        if (!tab.wc.isDestroyed()) tab.wc.close();
      } catch {}
    }
    this.tabs.clear();
    this.order = [];
    this.ctx.removeWindow(this);
  }
}

module.exports = { BrowserWindowController, cleanTrackingParams, CHROME_BASE };
