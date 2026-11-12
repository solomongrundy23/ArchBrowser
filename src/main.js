'use strict';

const {
  app,
  BrowserWindow,
  Menu,
  session,
  protocol,
  net,
  shell,
  dialog,
  nativeTheme,
  systemPreferences,
  ipcMain,
  Tray,
  nativeImage,
  clipboard,
  Notification,
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

app.setName('ArchBrowser');
// Версия приложения для интерфейса. В package.json остаётся корректная
// semver-версия (1.0.0), а четырёхчастная 1.0.0.0 задаётся в buildVersion
// и попадает в FileVersion Windows.
const APP_VERSION = (() => {
  try {
    const pkg = require('../package.json');
    return pkg.buildVersion || (pkg.build && pkg.build.buildVersion) || app.getVersion();
  } catch {
    return app.getVersion();
  }
})();
// Отдельный AppUserModelID для исходников и собранной версии. Это не только
// разделяет группы на панели задач, но и сбрасывает старый кеш иконки,
// из-за которого Windows могла держать иконку Electron.
const APP_AUMID = process.defaultApp
  ? 'com.archbrowser.desktop.dev'
  : 'com.archbrowser.desktop';
if (process.platform === 'win32') app.setAppUserModelId(APP_AUMID);

const IS_SMOKE = process.argv.includes('--smoke-test');
// Тестовый запуск не должен менять настройки, тему и закладки пользователя —
// и не должен упираться в single-instance lock уже открытого браузера.
if (IS_SMOKE) {
  try {
    const testDir = path.join(os.tmpdir(), `arch-smoke-${process.pid}-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
    app.setPath('userData', testDir);
  } catch {}
}
// Изолированный профиль для UI-тестов/автоматизации: не трогает данные
// пользователя и не конфликтует с запущенным браузером.
const ALT_USER_DATA = process.env.ARCHBROWSER_USER_DATA;
if (ALT_USER_DATA) {
  try {
    fs.mkdirSync(ALT_USER_DATA, { recursive: true });
    app.setPath('userData', ALT_USER_DATA);
  } catch {}
}
const RESOURCES_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'resources')
  : path.join(__dirname, '..', 'resources');
const USER_DATA_DIR = app.getPath('userData');

// Журнал запуска: если приложение не открылось, причина останется в
// %APPDATA%\ArchBrowser\startup.log, а не исчезнет вместе с консолью.
function logStartup(...parts) {
  try {
    const line = `[${new Date().toISOString()}] ${parts.map((p) => (
      p && p.stack ? p.stack : typeof p === 'string' ? p : JSON.stringify(p)
    )).join(' ')}\n`;
    fs.appendFileSync(path.join(USER_DATA_DIR, 'startup.log'), line, 'utf8');
  } catch {}
}
process.on('uncaughtException', (err) => {
  logStartup('uncaughtException:', err);
  console.error('[startup] uncaughtException:', err);
});
process.on('unhandledRejection', (err) => {
  logStartup('unhandledRejection:', err);
  console.error('[startup] unhandledRejection:', err);
});

// Однократный перенос профиля прежней версии (Aegis Browser -> ArchBrowser).
function migrateLegacyProfile() {
  if (IS_SMOKE) return;
  const legacyDir = path.join(app.getPath('appData'), 'Aegis Browser');
  if (!fs.existsSync(legacyDir)) return;
  if (fs.existsSync(path.join(USER_DATA_DIR, 'settings.json'))) return;
  try {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
    for (const name of ['settings.json', 'history.json', 'bookmarks.json', 'vpn.json']) {
      const from = path.join(legacyDir, name);
      if (!fs.existsSync(from)) continue;
      const text = fs.readFileSync(from, 'utf8').replace(/aegis:\/\//g, 'arch://');
      fs.writeFileSync(path.join(USER_DATA_DIR, name), text, 'utf8');
    }
    const fromExtensions = path.join(legacyDir, 'extensions');
    if (fs.existsSync(fromExtensions)) {
      fs.cpSync(fromExtensions, path.join(USER_DATA_DIR, 'extensions'), { recursive: true });
    }
    console.log('[profile] перенесён профиль прежней версии');
  } catch (err) {
    console.warn('[profile] не удалось перенести профиль:', err.message);
  }
}
migrateLegacyProfile();

const { Settings, DEFAULTS } = require('./core/settings');
const { Privacy } = require('./core/privacy');
const { VpnManager, parseLink } = require('./core/vpn');
const { ExtensionsManager } = require('./core/extensions');
const { JsonStore } = require('./core/store');
const { PasswordStore } = require('./core/passwords');
const { TelegramProxyService } = require('./core/telegram-proxies');
const { MediaManager, isVideoHost, isMusicHost } = require('./core/media');
const { RssService } = require('./core/rss');
const { PlayerService } = require('./core/player');
const { TorrentService } = require('./core/torrent');
const {
  THEMES, THEME_IDS, isThemeId, isAppearance, daysUntilNewYear, activeHolidayTheme,
} = require('./core/themes');
const importer = require('./core/importers');
const { BrowserWindowController } = require('./window');

const settings = new Settings(USER_DATA_DIR, (patch) => {
  // Изменение темы или режима (светлый/тёмный) требует пересборки палитры.
  if (patch && ('theme' in patch || 'appearance' in patch)) {
    try {
      broadcastTheme();
    } catch {}
  }
  if (patch && 'holidayThemeAuto' in patch) {
    try {
      checkHolidayTheme();
    } catch {}
  }
  scheduleBroadcastAll();
});

// Старые профили хранили режим в самой теме (system/light/dark).
// Переносим его в отдельную настройку appearance один раз.
if (['system', 'light', 'dark'].includes(String(settings.get('theme') || ''))) {
  const legacyTheme = String(settings.get('theme'));
  settings.set({ theme: 'original', appearance: legacyTheme });
}
const passwords = new PasswordStore(USER_DATA_DIR);
const telegramProxies = new TelegramProxyService({ userDataDir: USER_DATA_DIR });
passwords.setAutoLockMinutes(settings.get('passwordAutoLockMinutes'));

let mediaManager = null;
let rssService = null;
let playerService = null;
let torrentService = null;
// Флаг полного выхода: в режиме «работать в фоне» окно прячется, а не закрывает
// приложение.
let quitting = false;

const CHROME_VERSION = process.versions.chrome || '120.0.0.0';
const USER_AGENT = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Safari/537.36`;
// Только список языков: q-веса Chromium расставляет сам. Если передать их
// сюда, заголовок Accept-Language получается битым (q=0.9 повторяется дважды),
// а это для антибот-защиты — верный признак подделки.
const ACCEPT_LANGUAGES = 'ru-RU,ru,en-US,en';
app.userAgentFallback = USER_AGENT;

// ------------------------------------------------------------------ theme
const THEME_ARG = (process.argv.find((arg) => arg.startsWith('--theme=')) || '').split('=')[1];

function normalizeAccent(raw) {
  const match = /^#?([0-9a-f]{6})/i.exec(String(raw || ''));
  return match ? `#${match[1].toLowerCase()}` : '#60cdff';
}

function relLuminance(hex) {
  const value = normalizeAccent(hex).slice(1);
  const channel = (offset) => {
    const c = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

function accentContrast(hex) {
  return relLuminance(hex) > 0.45 ? '#07120c' : '#ffffff';
}

function currentTheme() {
  // Совместимость со старыми профилями: theme = system/light/dark
  // раньше совмещал тему и режим. Теперь это две отдельные настройки.
  let themeId = String(settings.get('theme') || 'original');
  let appearance = String(settings.get('appearance') || 'system');
  if (themeId === 'system' || themeId === 'light' || themeId === 'dark') {
    appearance = themeId;
    themeId = 'original';
  }
  if (!isThemeId(themeId)) themeId = 'original';
  if (!isAppearance(appearance)) appearance = 'system';

  const preset = THEMES[themeId];
  const amoled = themeId === 'amoled';
  // AMOLED всегда тёмный: истинно чёрный фон и светлые элементы.
  const dark = amoled || (appearance === 'system' ? nativeTheme.shouldUseDarkColors : appearance === 'dark');

  let systemAccent = '#60cdff';
  try {
    // Акцент системы берём и на Windows, и на macOS: в macOS в разделе
    // «Оформление» несколько вариантов акцента (синий, фиолетовый, розовый…).
    if (process.platform === 'win32' || process.platform === 'darwin') {
      systemAccent = normalizeAccent(systemPreferences.getAccentColor());
    }
  } catch {}

  // «Оригинальная» сохраняет нейтральный фон, но элементы получают акцент
  // системы. «Акцентная» дополнительно тонирует поверхности.
  let accent = systemAccent;
  if (preset.accent) accent = preset.accent;

  return {
    name: themeId,
    title: preset.title,
    appearance,
    mode: dark ? 'dark' : 'light',
    dark,
    accent,
    accent2: preset.accent2 || '',
    festive: !!preset.festive,
    holiday: !!preset.holiday,
    accentContrast: accentContrast(accent),
    background: amoled ? '#000000' : dark ? '#1a1a1a' : '#f3f3f3',
    overlayColor: amoled ? '#000000' : dark ? '#202020' : '#f3f3f3',
    overlaySymbol: dark ? '#f2f2f2' : '#1b1b1b',
    daysToNewYear: daysUntilNewYear(),
  };
}

// Автотема праздников: включаем за 7 дней до даты. После праздника
// выключаем на следующий день; Новый год остаётся по 6 января. Прежняя
// тема запоминается один раз при входе в окно праздника, поэтому ручные
// переключения внутри окна не теряются.
function checkHolidayTheme() {
  if (IS_SMOKE) return;
  try {
    const auto = settings.get('holidayThemeAuto') !== false;
    const current = activeHolidayTheme(new Date());
    const activeId = auto && current ? current.id : '';
    const marker = String(settings.get('holidayActiveTheme') || '');
    if (activeId) {
      if (marker === activeId) {
        // Праздник уже включён. Если в профиле осталась базовая тема
        // (например, после перезапуска или сброса настроек), возвращаем
        // праздничную; ручной выбор другой темы не трогаем.
        const currentTheme = String(settings.get('theme') || '');
        const baseTheme = String(settings.get('holidayBaseTheme') || '');
        if (currentTheme && currentTheme !== baseTheme) return false;
      }
      const baseTheme = marker
        ? String(settings.get('holidayBaseTheme') || 'original')
        : String(settings.get('theme') || 'original');
      const baseAppearance = marker
        ? String(settings.get('holidayBaseAppearance') || 'system')
        : String(settings.get('appearance') || 'system');
      settings.set({
        holidayBaseTheme: baseTheme,
        holidayBaseAppearance: baseAppearance,
        holidayActiveTheme: activeId,
        theme: activeId,
      });
      return true;
    }
    if (marker) {
      const baseTheme = String(settings.get('holidayBaseTheme') || 'original');
      const baseAppearance = String(settings.get('holidayBaseAppearance') || 'system');
      // Восстанавливаем прежнюю тему, только если в окне праздника её никто
      // не менял. Если пользователь выбрал свою тему, его выбор главнее.
      const restore = String(settings.get('theme') || '') === marker;
      const patch = {
        holidayActiveTheme: '',
        holidayBaseTheme: '',
        holidayBaseAppearance: '',
      };
      if (restore) {
        patch.theme = isThemeId(baseTheme) ? baseTheme : 'original';
        patch.appearance = isAppearance(baseAppearance) ? baseAppearance : 'system';
      }
      settings.set(patch);
      return restore;
    }
  } catch (err) {
    console.error('[theme] holiday:', err.message);
  }
  return false;
}

// ------------------------------------------------------------------ switches
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');
app.commandLine.appendSwitch('no-pings');
app.commandLine.appendSwitch('disable-breakpad');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-domain-reliability');
app.commandLine.appendSwitch('disable-features', [
  'Translate',
  'OptimizationHints',
  'MediaRouter',
  'AutofillServerCommunication',
  'InterestFeedContentSuggestions',
  'CalculateNativeWinOcclusion',
  'PrivacySandboxSettings4',
  'TopicsAPI',
  'InterestGroupStorage',
  'Fledge',
  'PrivacySandboxAdsAPIs',
  'AttributionReportingCrossAppWeb',
].join(','));

if (settings.get('doh')) {
  app.commandLine.appendSwitch('dns-over-https-mode', 'secure');
  app.commandLine.appendSwitch('dns-over-https-templates', settings.get('dohServer') || 'https://cloudflare-dns.com/dns-query');
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'arch',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

// ------------------------------------------------------------------ stores
// История хранится построчно (JSONL): новая запись дописывается в конец
// файла, поэтому переходы по страницам не переписывают весь файл целиком и
// импорт десятков тысяч записей выполняется быстро.
const HISTORY_LIMIT = 100000;

class HistoryStore {
  constructor(file) {
    this.file = file;
    this.items = [];
    this._load();
  }

  _load() {
    let text = '';
    try {
      text = fs.readFileSync(this.file, 'utf8');
    } catch {
      return;
    }
    if (!text.trim()) return;
    // Прежний формат — один JSON-объект {items:[...]} или массив. Переводим
    // его в построчный. Читаем целиком: смешанный файл не распарсится и
    // уйдёт в построчную ветку.
    let legacy = null;
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) legacy = parsed;
      else if (parsed && Array.isArray(parsed.items)) legacy = parsed.items;
    } catch {}
    if (legacy) {
      this.items = legacy.slice(0, HISTORY_LIMIT);
      this._rewrite();
      return;
    }
    const entries = [];
    const titles = new Map();
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let item;
      try {
        item = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (!item) continue;
      if (item.u) {
        titles.set(item.u, item.t || '');
        continue;
      }
      if (item.url) entries.push(item);
    }
    entries.reverse();
    for (const item of entries) {
      if (titles.has(item.url)) item.title = titles.get(item.url);
    }
    this.items = entries.slice(0, HISTORY_LIMIT);
  }

  _append(lines) {
    if (!lines.length) return;
    try {
      fs.appendFileSync(this.file, lines.join('\n') + '\n', 'utf8');
    } catch (err) {
      console.error('[history] cannot append', err.message);
    }
  }

  _rewrite() {
    try {
      const body = this.items.map((item) => JSON.stringify(item)).join('\n');
      fs.writeFileSync(this.file, body ? body + '\n' : '', 'utf8');
    } catch (err) {
      console.error('[history] cannot rewrite', err.message);
    }
  }

  add(url, title) {
    if (!/^https?:/i.test(url)) return;
    const last = this.items[0];
    if (last && last.url === url && Date.now() - last.ts < 2000) return;
    const item = {
      id: crypto.randomUUID(),
      url,
      title: title || url,
      ts: Date.now(),
    };
    this.items.unshift(item);
    if (this.items.length > HISTORY_LIMIT) this.items.length = HISTORY_LIMIT;
    this._append([JSON.stringify(item)]);
  }

  // Массовый импорт: дедупликация через Set, файл дописывается одним блоком.
  addMany(entries = []) {
    const seen = new Set(this.items.map((item) => item.url));
    const added = [];
    const now = Date.now();
    for (const entry of entries) {
      const url = entry && entry.url;
      if (!url || !/^https?:/i.test(url)) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      added.push({
        id: crypto.randomUUID(),
        url,
        title: entry.title || url,
        ts: entry.ts || now,
      });
    }
    if (!added.length) return { added: 0, total: this.items.length };
    this._append(added.map((item) => JSON.stringify(item)));
    this.items = [...added.reverse(), ...this.items].slice(0, HISTORY_LIMIT);
    return { added: added.length, total: this.items.length };
  }

  updateTitle(url, title) {
    if (!title || !url) return;
    const entry = this.items.find((item) => item.url === url);
    if (!entry || entry.title === title) return;
    entry.title = title;
    this._append([JSON.stringify({ u: url, t: title })]);
  }

  search(query = '', limit = 200) {
    const q = String(query).trim().toLowerCase();
    let items = this.items;
    if (q) {
      items = items.filter((i) => i.url.toLowerCase().includes(q) || (i.title || '').toLowerCase().includes(q));
    }
    return items.slice(0, limit);
  }

  clear() {
    this.items = [];
    try {
      fs.writeFileSync(this.file, '', 'utf8');
    } catch {}
  }
}

class BookmarksStore {
  constructor(file) {
    this.store = new JsonStore(file, { items: [], folders: [] });
  }
  get items() {
    return this.store.get('items') || [];
  }
  get folders() {
    return this.store.get('folders') || [];
  }
  normalize(url) {
    try {
      const u = new URL(url);
      u.hash = '';
      return u.toString();
    } catch {
      return url;
    }
  }
  has(url) {
    if (!/^https?:/i.test(url || '')) return false;
    const norm = this.normalize(url);
    return this.items.some((b) => this.normalize(b.url) === norm);
  }
  add({ url, title, folderId }) {
    if (!/^https?:/i.test(url || '')) throw new Error('Нельзя добавить эту страницу в закладки');
    const norm = this.normalize(url);
    if (this.items.some((b) => this.normalize(b.url) === norm)) return { added: false };
    const items = this.items;
    const known = folderId && this.folders.some((f) => f.id === folderId);
    items.unshift({
      id: crypto.randomUUID(),
      url,
      title: title || url,
      folderId: known ? folderId : null,
      ts: Date.now(),
    });
    this.store.set({ items });
    return { added: true };
  }
  // ---------- папки ----------
  addFolder({ name, parentId }) {
    const clean = String(name || '').trim();
    if (!clean) throw new Error('Укажите название папки');
    const folders = [...this.folders];
    folders.push({
      id: crypto.randomUUID(),
      name: clean.slice(0, 80),
      parentId: parentId && folders.some((f) => f.id === parentId) ? parentId : null,
      ts: Date.now(),
    });
    this.store.set({ folders });
    return folders[folders.length - 1];
  }
  renameFolder(id, name) {
    const clean = String(name || '').trim();
    if (!clean) throw new Error('Укажите название папки');
    const folders = this.folders.map((f) => (f.id === id ? { ...f, name: clean.slice(0, 80) } : f));
    this.store.set({ folders });
    return true;
  }
  // Удаление папки: вложенные папки удаляются, закладки переносятся в корень.
  removeFolder(id) {
    const doomed = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const folder of this.folders) {
        if (folder.parentId && doomed.has(folder.parentId) && !doomed.has(folder.id)) {
          doomed.add(folder.id);
          changed = true;
        }
      }
    }
    this.store.set({
      folders: this.folders.filter((f) => !doomed.has(f.id)),
      items: this.items.map((b) => (b.folderId && doomed.has(b.folderId) ? { ...b, folderId: null } : b)),
    });
    return true;
  }
  moveBookmark(id, folderId) {
    const target = folderId && this.folders.some((f) => f.id === folderId) ? folderId : null;
    this.store.set({
      items: this.items.map((b) => (b.id === id ? { ...b, folderId: target } : b)),
    });
    return true;
  }
  // Редактирование закладки: название и адрес. Пустые поля игнорируются,
  // чтобы случайное сохранение не сломало запись.
  update(id, { title, url, folderId } = {}) {
    const current = this.items.find((b) => b.id === id);
    if (!current) throw new Error('Закладка не найдена');
    const next = { ...current };
    if (typeof title === 'string' && title.trim()) next.title = title.trim().slice(0, 300);
    if (typeof url === 'string' && url.trim()) {
      if (!/^https?:/i.test(url.trim())) throw new Error('Адрес должен начинаться с http:// или https://');
      next.url = url.trim();
    }
    if (folderId !== undefined) {
      next.folderId = folderId && this.folders.some((f) => f.id === folderId) ? folderId : null;
    }
    this.store.set({ items: this.items.map((b) => (b.id === id ? next : b)) });
    return next;
  }
  // Дерево папок с закладками для панели и панели закладок.
  tree() {
    const folders = this.folders.map((f) => ({ ...f, children: [], bookmarks: [] }));
    const byId = new Map(folders.map((f) => [f.id, f]));
    const roots = [];
    for (const folder of folders) {
      const parent = folder.parentId ? byId.get(folder.parentId) : null;
      if (parent) parent.children.push(folder);
      else roots.push(folder);
    }
    const orphan = [];
    for (const item of this.items) {
      const folder = item.folderId ? byId.get(item.folderId) : null;
      if (folder) folder.bookmarks.push(item);
      else orphan.push(item);
    }
    return { folders: roots, bookmarks: orphan };
  }
  remove(id) {
    this.store.set({ items: this.items.filter((b) => b.id !== id) });
  }
  removeByUrl(url) {
    const norm = this.normalize(url);
    this.store.set({ items: this.items.filter((b) => this.normalize(b.url) !== norm) });
  }
  toggle({ url, title, folderId }) {
    if (!/^https?:/i.test(url || '')) return { added: false, error: 'Недопустимый URL' };
    if (this.has(url)) {
      this.removeByUrl(url);
      return { added: false };
    }
    const result = this.add({ url, title, folderId });
    return result;
  }
}

const history = new HistoryStore(path.join(USER_DATA_DIR, 'history.json'));
const bookmarks = new BookmarksStore(path.join(USER_DATA_DIR, 'bookmarks.json'));

// Кэш иконок сайтов по хосту — для панели закладок и новых вкладок.
const faviconStore = new JsonStore(path.join(USER_DATA_DIR, 'favicons.json'), { byHost: {} });
function recordFavicon(url, faviconUrl) {
  try {
    const host = new URL(url).hostname;
    if (!host || !faviconUrl) return;
    const byHost = faviconStore.get('byHost') || {};
    if (byHost[host] === faviconUrl) return;
    byHost[host] = faviconUrl;
    faviconStore.set({ byHost });
  } catch {}
}
function faviconFor(url) {
  try {
    const host = new URL(url).hostname;
    return (faviconStore.get('byHost') || {})[host] || '';
  } catch {
    return '';
  }
}

const downloads = [];
const downloadItems = new Map();
const downloadSessions = new WeakSet();

function uniqueSavePath(dir, filename) {
  const parsed = path.parse(filename || 'download');
  let candidate = path.join(dir, `${parsed.name}${parsed.ext || ''}`);
  let i = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${parsed.name} (${i++})${parsed.ext || ''}`);
  }
  return candidate;
}

// Каталог загрузок: пользовательский, иначе системная папка «Загрузки».
// Если папка недоступна (удалена, нет прав, отключён диск), берём следующую
// рабочую — иначе Electron молча обрывает скачивание.
function ensureDownloadDir() {
  const preferred = String(settings.get('downloadDir') || '').trim();
  const candidates = [
    preferred,
    app.getPath('downloads'),
    path.join(os.homedir(), 'Downloads'),
    app.getPath('temp'),
  ];
  for (const dir of candidates) {
    if (!dir) continue;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      return { dir, fallback: !!preferred && dir !== preferred };
    } catch {}
  }
  return { dir: app.getPath('temp'), fallback: !!preferred };
}

function downloadToast(text, type = 'info') {
  for (const ctrl of controllers) {
    try {
      ctrl.showToast(text, type);
    } catch {}
  }
}

// Системное уведомление Windows: видно, даже если окно браузера свёрнуто.
function downloadNotification(title, body, onClick) {
  if (!settings.get('downloadNotify')) return;
  try {
    if (!Notification.isSupported()) return;
    const icon = path.join(ctx.assetsDir, 'icon.png');
    const note = new Notification({ title, body, icon, silent: false });
    if (onClick) {
      note.on('click', () => {
        try {
          if (onClick === 'panel') {
            showMainWindow('downloads');
          } else if (typeof onClick === 'function') {
            onClick();
          }
        } catch {}
      });
    }
    note.show();
  } catch {}
}

// Системное уведомление о новой композиции (все платформы: macOS/Windows/Linux).
function trackNotification(title, body) {
  if (!settings.get('trackNotify')) return;
  try {
    if (!Notification.isSupported()) return;
    const icon = path.join(ctx.assetsDir, 'icon.png');
    const note = new Notification({ title: title || 'Сейчас играет', body: body || '', icon, silent: true });
    note.show();
  } catch {}
}

function askDownloadPath(item, win) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const { dir } = ensureDownloadDir();
      const options = {
        title: 'Сохранить файл',
        buttonLabel: 'Сохранить',
        cancelLabel: 'Отмена',
        defaultPath: path.join(dir, item.getFilename() || 'download'),
        properties: ['showOverwriteConfirmation', 'createDirectory'],
      };
      const pending = win && !win.isDestroyed()
        ? dialog.showSaveDialog(win, options)
        : dialog.showSaveDialog(options);
      pending.then((result) => {
        finish(!result.canceled && result.filePath ? result.filePath : null);
      }).catch(() => finish(null));
    } catch {
      finish(null);
    }
  });
}

function setupDownloads(ses) {
  if (downloadSessions.has(ses)) return;
  downloadSessions.add(ses);
  ses.on('will-download', async (_event, item) => {
    const filename = item.getFilename() || 'download';
    const mode = settings.get('downloadMode') === 'ask' ? 'ask' : 'auto';
    const win = BrowserWindow.getFocusedWindow() ||
      (controllers[0] && controllers[0].window) || null;

    let savePath = '';
    if (mode === 'ask') {
      // Ставим на паузу, чтобы файл не начал качаться, пока выбирают папку.
      try {
        item.pause();
      } catch {}
      savePath = await askDownloadPath(item, win);
      if (!savePath) {
        try {
          item.cancel();
        } catch {}
        downloadToast('Загрузка отменена', 'info');
        return;
      }
    } else {
      const { dir, fallback } = ensureDownloadDir();
      if (fallback) {
        downloadToast('Папка загрузок недоступна — файл сохраняется в системную «Загрузки»', 'warning');
      }
      savePath = uniqueSavePath(dir, filename);
    }

    try {
      item.setSavePath(savePath);
    } catch (err) {
      try {
        item.cancel();
      } catch {}
      downloadToast(`Не удалось сохранить файл: ${err.message}`, 'error');
      downloadNotification('Ошибка загрузки', `${filename}: ${err.message}`);
      return;
    }
    if (mode === 'ask') {
      try {
        item.resume();
      } catch {}
    }

    const rec = {
      id: crypto.randomUUID(),
      filename: path.basename(savePath),
      path: savePath,
      url: item.getURL(),
      total: item.getTotalBytes(),
      received: 0,
      speed: 0,
      state: 'progressing',
      startedAt: Date.now(),
      paused: false,
    };
    downloads.unshift(rec);
    if (downloads.length > 100) downloads.length = 100;
    downloadItems.set(rec.id, item);
    scheduleBroadcastAll();
    updateDownloadIndicators();
    downloadToast(`Загрузка началась: ${rec.filename}`, 'success');
    downloadNotification('Загрузка началась', rec.filename, 'panel');

    let lastBytes = 0;
    let lastTime = Date.now();
    item.on('updated', (_e, state) => {
      rec.received = item.getReceivedBytes();
      rec.total = item.getTotalBytes();
      rec.state = state;
      try {
        rec.paused = item.isPaused();
      } catch {}
      const now = Date.now();
      if (now - lastTime > 500) {
        rec.speed = Math.round(((rec.received - lastBytes) * 1000) / (now - lastTime));
        lastBytes = rec.received;
        lastTime = now;
      }
      scheduleBroadcastAll();
      updateDownloadIndicators();
    });
    item.once('done', (_e, state) => {
      rec.state = state;
      rec.received = item.getReceivedBytes();
      rec.path = item.getSavePath();
      rec.finishedAt = Date.now();
      rec.paused = false;
      downloadItems.delete(rec.id);
      scheduleBroadcastAll();
      updateDownloadIndicators();

      if (state === 'completed') {
        downloadToast(`Загружено: ${rec.filename}`, 'success');
        downloadNotification('Загрузка завершена', rec.filename, () => {
          shell.openPath(rec.path).catch(() => {});
        });
        const target = win && !win.isDestroyed() ? win : null;
        const isTorrentFile = /\.torrent$/i.test(rec.path || rec.filename);
        if (isTorrentFile && settings.get('featureBittorrent') !== false && torrentService) {
          // Скачанный .torrent сразу предлагаем открыть во встроенном
          // клиенте: иначе клик «Скачать» выглядит так, будто ничего не
          // произошло — файл молча уходит в папку загрузок.
          const options = {
            type: 'question',
            title: 'Торрент-файл скачан',
            message: rec.filename,
            detail: 'Добавить этот торрент в BitTorrent-клиент?',
            buttons: ['Добавить в клиент', 'Показать в папке', 'Закрыть'],
            defaultId: 0,
            cancelId: 2,
            noLink: true,
          };
          const prompt = target
            ? dialog.showMessageBox(target, options)
            : dialog.showMessageBox(options);
          prompt.then(async (result) => {
            if (result.response !== 0) {
              if (result.response === 1) shell.showItemInFolder(rec.path);
              return;
            }
            try {
              const dir = String(
                settings.get('torrentDir') || settings.get('downloadDir') || path.join(os.homedir(), 'Downloads'),
              );
              fs.mkdirSync(dir, { recursive: true });
              await torrentService.add({ kind: 'file', value: rec.path }, { dir });
              const ctrl = activeController();
              if (ctrl) ctrl.setUIMode('torrent');
              downloadToast('Торрент добавлен в клиент', 'success');
            } catch (err) {
              downloadToast(`Не удалось добавить торрент: ${err.message}`, 'error');
            }
          }).catch(() => {});
        } else if (settings.get('downloadOpenPrompt')) {
          const options = {
            type: 'info',
            title: 'Загрузка завершена',
            message: rec.filename,
            detail: `Файл сохранён в ${path.dirname(rec.path)}`,
            buttons: ['Открыть', 'Показать в папке', 'Закрыть'],
            defaultId: 0,
            cancelId: 2,
            noLink: true,
          };
          const prompt = target
            ? dialog.showMessageBox(target, options)
            : dialog.showMessageBox(options);
          prompt.then((result) => {
            if (result.response === 0) shell.openPath(rec.path).catch(() => {});
            else if (result.response === 1) shell.showItemInFolder(rec.path);
          }).catch(() => {});
        }
      } else if (state === 'interrupted') {
        downloadToast(`Ошибка загрузки: ${rec.filename}`, 'error');
        downloadNotification('Ошибка загрузки', rec.filename, 'panel');
      } else if (state === 'cancelled') {
        downloadToast(`Загрузка отменена: ${rec.filename}`, 'info');
      }
    });
  });
}

// ------------------------------------------------------------------ tray и прогресс
let tray = null;
const trayProgressCache = new Map();
let trayIdleImage = null;

function trayIconPath() {
  return path.join(ctx.assetsDir, 'icon.png');
}

function idleTrayImage() {
  if (!trayIdleImage) {
    try {
      const image = nativeImage.createFromPath(trayIconPath());
      trayIdleImage = image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 16, height: 16, quality: 'best' });
    } catch {
      trayIdleImage = nativeImage.createEmpty();
    }
  }
  return trayIdleImage;
}

// Рисуем маленькое кольцо прогресса поверх нейтрального круга. Это позволяет
// показывать загрузку прямо в области уведомлений Windows, а не только на
// кнопке задачи. Буфер nativeImage на Windows имеет порядок BGRA.
function progressTrayImage(fraction) {
  const percent = Math.max(0, Math.min(100, Math.round(fraction * 100)));
  const key = Math.round(percent / 2) * 2;
  if (trayProgressCache.has(key)) return trayProgressCache.get(key);
  const size = 32;
  const buf = Buffer.alloc(size * size * 4, 0);
  const cx = size / 2 - 0.5;
  const cy = size / 2 - 0.5;
  const accent = normalizeAccent((() => {
    try {
      return currentTheme().accent;
    } catch {
      return '#60cdff';
    }
  })());
  const ar = parseInt(accent.slice(1, 3), 16);
  const ag = parseInt(accent.slice(3, 5), 16);
  const ab = parseInt(accent.slice(5, 7), 16);
  const set = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= size || y >= size || a <= 0) return;
    const i = (y * size + x) * 4;
    const da = buf[i + 3] / 255;
    const sa = Math.min(1, a / 255);
    const outA = sa + da * (1 - sa);
    if (outA <= 0) return;
    buf[i] = Math.round((b * sa + buf[i] * da * (1 - sa)) / outA);
    buf[i + 1] = Math.round((g * sa + buf[i + 1] * da * (1 - sa)) / outA);
    buf[i + 2] = Math.round((r * sa + buf[i + 2] * da * (1 - sa)) / outA);
    buf[i + 3] = Math.round(outA * 255);
  };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const distance = Math.hypot(dx, dy);
      // Тёмный нейтральный диск — читается и на светлой, и на тёмной панели.
      if (distance <= 10.5) {
        const edge = Math.max(0, Math.min(1, 11.5 - distance));
        set(x, y, 32, 32, 32, Math.round(238 * edge));
      }
      // Фоновая дорожка кольца.
      if (distance > 12.0 && distance <= 14.2) {
        set(x, y, 150, 150, 150, 145);
      }
      // Заполненная часть кольца, по часовой стрелке от 12 часов.
      if (distance > 12.0 && distance <= 14.2) {
        let angle = Math.atan2(dx, -dy);
        if (angle < 0) angle += Math.PI * 2;
        if (angle <= (key / 100) * Math.PI * 2) {
          set(x, y, ar, ag, ab, 255);
        }
      }
    }
  }
  // Стрелка загрузки в центре.
  for (let y = 10; y <= 21; y += 1) {
    const half = y <= 15 ? 1 : Math.max(0, 5 - (y - 16));
    for (let x = Math.round(cx) - half; x <= Math.round(cx) + half; x += 1) {
      set(x, y, 245, 245, 245, 235);
    }
  }
  let image;
  try {
    image = nativeImage.createFromBitmap(buf, { width: size, height: size, scaleFactor: 2 });
  } catch {
    image = idleTrayImage();
  }
  trayProgressCache.set(key, image);
  return image;
}

function showMainWindow(mode) {
  let ctrl = activeController();
  if (!ctrl) ctrl = createWindow();
  if (!ctrl || !ctrl.window || ctrl.window.isDestroyed()) return;
  if (ctrl.window.isMinimized()) ctrl.window.restore();
  ctrl.window.show();
  ctrl.window.focus();
  if (mode) ctrl.setUIMode(mode);
}

function ensureTray() {
  if (tray) return tray;
  try {
    tray = new Tray(idleTrayImage());
    tray.setToolTip('ArchBrowser');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Открыть ArchBrowser', click: () => showMainWindow() },
      { label: 'Новая вкладка', click: () => showMainWindow() },
      { label: 'Загрузки', click: () => showMainWindow('downloads') },
      { type: 'separator' },
      { label: 'Выход', click: () => app.quit() },
    ]));
    tray.on('click', () => showMainWindow());
    tray.on('double-click', () => showMainWindow());
  } catch (err) {
    console.warn('[tray] не удалось создать значок:', err.message);
    tray = null;
  }
  return tray;
}

function updateDownloadIndicators() {
  const active = downloads.filter((item) => item.state === 'progressing');
  let received = 0;
  let total = 0;
  for (const item of active) {
    received += Math.max(0, item.received || 0);
    total += Math.max(0, item.total || 0);
  }
  const fraction = total > 0 ? Math.min(1, received / total) : 0;
  for (const ctrl of controllers) {
    try {
      if (!ctrl.window || ctrl.window.isDestroyed()) continue;
      if (!active.length) ctrl.window.setProgressBar(-1);
      else if (total > 0) ctrl.window.setProgressBar(fraction, { mode: 'normal' });
      else ctrl.window.setProgressBar(0.5, { mode: 'indeterminate' });
    } catch {}
  }
  if (!tray) return;
  try {
    if (active.length) {
      tray.setImage(progressTrayImage(fraction));
      const label = total > 0
        ? `Загрузка ${Math.round(fraction * 100)}%`
        : `Загрузка (${active.length})`;
      tray.setToolTip(`ArchBrowser — ${label}`);
    } else {
      tray.setImage(idleTrayImage());
      tray.setToolTip('ArchBrowser');
    }
  } catch {}
}

// ------------------------------------------------------------------ privacy
let windows = new Set();
const controllers = new Set();

// Состояние стартовой заставки: расширения устанавливаются уже после
// создания окна, чтобы логотип и прогресс появлялись сразу.
let bootReady = IS_SMOKE;
let bootStatus = { ready: IS_SMOKE, phase: 'Запуск', done: 0, total: 15 };

let broadcastTimer = null;
function scheduleBroadcastAll() {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    for (const ctrl of controllers) ctrl.broadcast();
  }, 250);
}

function broadcastAll() {
  for (const ctrl of controllers) ctrl.broadcast();
}

// Системная тема, акцент и окно-оверлей пересобираются при их смене в Windows.
function broadcastTheme() {
  const theme = currentTheme();
  for (const ctrl of controllers) {
    try {
      ctrl.applyTheme(theme);
    } catch {}
    ctrl.broadcast();
  }
}

nativeTheme.on('updated', broadcastTheme);
if (process.platform === 'win32') {
  try {
    systemPreferences.on('accent-color-changed', broadcastTheme);
    systemPreferences.on('color-changed', broadcastTheme);
  } catch {}
}

const privacy = new Privacy({
  resourcesDir: RESOURCES_DIR,
  getSettings: () => settings.all,
  onBlocked: scheduleBroadcastAll,
});

// ------------------------------------------------------------------ vpn
const vpn = new VpnManager({
  resourcesDir: RESOURCES_DIR,
  userDataDir: USER_DATA_DIR,
  getSettings: () => settings.all,
});
vpn.on('change', scheduleBroadcastAll);

// ------------------------------------------------------------------ extensions
const extensions = new ExtensionsManager({
  dir: path.join(USER_DATA_DIR, 'extensions'),
  getSettings: () => settings.all,
  onChanged: () => scheduleBroadcastAll(),
});

// ------------------------------------------------------------------ медиа
mediaManager = new MediaManager({
  resourcesDir: RESOURCES_DIR,
  getSettings: () => settings.all,
  session: null,
  userAgent: USER_AGENT,
  // yt-dlp работает отдельным процессом — прокси VPN передаём ему явно.
  getProxy: () => {
    try {
      const st = vpn.status();
      if (st && st.connected && st.socksPort) return `socks5://127.0.0.1:${st.socksPort}`;
    } catch {}
    return '';
  },
  onChange: () => scheduleBroadcastAll(),
});


// ------------------------------------------------------------------ rss
rssService = new RssService({
  userDataDir: USER_DATA_DIR,
  getSettings: () => settings.all,
  session: null,
  onChange: () => {
    const items = rssService.items().slice(0, 60);
    for (const ctrl of controllers) ctrl.sendToNewTabs('arch:rss', items);
    scheduleBroadcastAll();
  },
});

// ------------------------------------------------------------------ плеер
playerService = new PlayerService({
  userDataDir: USER_DATA_DIR,
  getSettings: () => settings.all,
  onChange: () => scheduleBroadcastAll(),
});

// ------------------------------------------------------------------ torrent
torrentService = new TorrentService({
  userDataDir: USER_DATA_DIR,
  getSettings: () => settings.all,
  getDir: () => (settings.get('torrentDir') || settings.get('downloadDir') || path.join(os.homedir(), 'Downloads')),
  onChange: () => scheduleBroadcastAll(),
});
torrentService.restoreLater();

// ------------------------------------------------------------------ context
let mainSession = null;

function attachSession(ses, { isPrivate = false } = {}) {
  ses.setUserAgent(USER_AGENT, ACCEPT_LANGUAGES);
  registerArchProtocol(ses);
  privacy.install(ses);
  setupDownloads(ses);
}

function registerArchProtocol(ses) {
  try {
    ses.protocol.handle('arch', async (request) => {
      try {
        const url = new URL(request.url);
        if (url.hostname === 'asset') {
          const relative = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
          const file = path.resolve(ctx.assetsDir, relative);
          if (!file.startsWith(path.resolve(ctx.assetsDir) + path.sep)) {
            return new Response('Файл не найден', { status: 404 });
          }
          const data = await fs.promises.readFile(file);
          const ext = path.extname(file).toLowerCase();
          const types = {
            '.png': 'image/png',
            '.ico': 'image/x-icon',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml',
          };
          return new Response(data, {
            headers: {
              'content-type': types[ext] || 'application/octet-stream',
              'cache-control': 'public, max-age=86400',
            },
          });
        }
        let file = null;
        const serviceTitles = {
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
        const serviceTitle = serviceTitles[url.hostname] || '';
        if (serviceTitle) {
          const theme = currentTheme();
          const html = `<!DOCTYPE html><html lang="ru" data-theme="${theme.name}" data-mode="${theme.mode}">`
            + `<head><meta charset="utf-8"><title>${serviceTitle}</title>`
            + '<style>html,body{margin:0;height:100%;background:#1a1a1a;color:#f2f2f2;font-family:"Segoe UI",sans-serif}'
            + 'body{display:flex;align-items:center;justify-content:center;opacity:.001}</style></head>'
            + `<body><span>${serviceTitle} ArchBrowser</span></body></html>`;
          return new Response(html, {
            headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
          });
        }
        if (url.hostname === 'newtab') file = path.join(__dirname, 'ui', 'newtab.html');
        if (url.hostname === 'error') file = path.join(__dirname, 'ui', 'error.html');
        if (!file) {
          return new Response('Страница не найдена', {
            status: 404,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
          });
        }
        const body = await fs.promises.readFile(file, 'utf8');
        const theme = currentTheme();
        const html = body.replace(
          '/*__ARCH_THEME__*/',
          `--accent: ${theme.accent}; --accent-contrast: ${theme.accentContrast}; --accent-2: ${theme.accent2 || theme.accent};`,
        );
        return new Response(html, {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
          },
        });
      } catch (err) {
        console.error('[arch] protocol error:', err);
        return new Response('Внутренняя ошибка', {
          status: 500,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
      }
    });
  } catch (err) {
    // обработчик уже зарегистрирован для этой сессии
  }
}

const ctx = {
  settings,
  privacy,
  vpn,
  extensions,
  session,
  mainSession: null,
  pagePreload: path.join(__dirname, 'preload-page.js'),
  uiPreload: path.join(__dirname, 'preload-ui.js'),
  resourcesDir: RESOURCES_DIR,
  assetsDir: path.join(__dirname, '..', 'assets'),
  userAgent: USER_AGENT,
  acceptLanguages: ACCEPT_LANGUAGES,
  downloads,
  bookmarks,
  history,
  passwords,
  telegramProxies,
  get media() {
    return mediaManager;
  },
  get playerService() {
    return playerService;
  },
  get rssService() {
    return rssService;
  },
  get torrentService() {
    return torrentService;
  }, appVersion: APP_VERSION,
  chromeVersion: CHROME_VERSION,
  theme: currentTheme,
  createWindow: (options) => createWindow(options),
  attachSession,
  isQuitting: () => quitting,
  recordHistory: (url, title) => history.add(url, title),
  updateHistoryTitle: (url, title) => history.updateTitle(url, title),
  recordFavicon,
  faviconFor,
  removeWindow: (ctrl) => {
    controllers.delete(ctrl);
    windows.delete(ctrl);
  },
  broadcastAll,
  session,
};

function createWindow({ isPrivate = false, hidden = false, bootOverlay = false } = {}) {
  if (!ctx.mainSession) ctx.mainSession = mainSession;
  const ctrl = new BrowserWindowController(ctx, { isPrivate, hidden, bootOverlay });
  controllers.add(ctrl);
  windows.add(ctrl);
  return ctrl;
}

function activeController() {
  const focused = BrowserWindow.getFocusedWindow();
  for (const ctrl of controllers) {
    if (ctrl.window === focused) return ctrl;
  }
  return [...controllers][0] || null;
}

function controllerOf(event) {
  for (const ctrl of controllers) {
    if (ctrl.window && !ctrl.window.isDestroyed() && ctrl.window.webContents === event.sender) return ctrl;
  }
  return activeController();
}

// ------------------------------------------------------------------ menu
function buildMenu() {
  const withCtrl = (fn) => () => {
    const c = activeController();
    if (c) fn(c);
  };

  const template = [
    {
      label: 'Файл',
      submenu: [
        { label: 'Новая вкладка', accelerator: 'CmdOrCtrl+T', click: withCtrl((c) => c.createTab(settings.get('newTabPage') || 'arch://newtab')) },
        {
          label: 'Новое приватное окно',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => createWindow({ isPrivate: true }),
        },
        {
          label: 'Закрыть вкладку',
          accelerator: 'CmdOrCtrl+W',
          click: withCtrl((c) => c.closeTab(c.activeId)),
        },
        { type: 'separator' },
        { label: 'Настройки', accelerator: 'CmdOrCtrl+,', click: withCtrl((c) => c.setUIMode('settings')) },
        { label: 'Очистить данные…', accelerator: 'CmdOrCtrl+Shift+Delete', click: withCtrl((c) => c.setUIMode('settings')) },
        { type: 'separator' },
        { label: 'Выход', accelerator: 'Alt+F4', role: 'quit' },
      ],
    },
    {
      label: 'Правка',
      submenu: [
        { role: 'undo', label: 'Отменить' },
        { role: 'redo', label: 'Повторить' },
        { type: 'separator' },
        { role: 'cut', label: 'Вырезать' },
        { role: 'copy', label: 'Копировать' },
        { role: 'paste', label: 'Вставить' },
        { role: 'selectAll', label: 'Выделить всё' },
        { type: 'separator' },
        { label: 'Найти на странице', accelerator: 'CmdOrCtrl+F', click: withCtrl((c) => c.sendCommand('find-open')) },
      ],
    },
    {
      label: 'Вид',
      submenu: [
        { label: 'Обновить', accelerator: 'CmdOrCtrl+R', click: withCtrl((c) => c.reload()) },
        { label: 'Обновить без кеша', accelerator: 'CmdOrCtrl+Shift+R', click: withCtrl((c) => c.reloadHard()) },
        { type: 'separator' },
        { label: 'Увеличить', accelerator: 'CmdOrCtrl+Plus', click: withCtrl((c) => c.zoom(0.1)) },
        { label: 'Уменьшить', accelerator: 'CmdOrCtrl+-', click: withCtrl((c) => c.zoom(-0.1)) },
        { label: 'Обычный масштаб', accelerator: 'CmdOrCtrl+0', click: withCtrl((c) => c.zoom(0)) },
        { type: 'separator' },
        { label: 'Инструменты разработчика', accelerator: 'CmdOrCtrl+Shift+I', click: withCtrl((c) => c.toggleDevTools()) },
        { type: 'separator' },
        { label: 'Полный экран', accelerator: 'F11', click: withCtrl((c) => c.toggleBrowserFullscreen()) },
      ],
    },
    {
      label: 'Переход',
      submenu: [
        { label: 'Назад', accelerator: 'Alt+Left', click: withCtrl((c) => c.goBack()) },
        { label: 'Вперёд', accelerator: 'Alt+Right', click: withCtrl((c) => c.goForward()) },
        { label: 'Домой', accelerator: 'Alt+Home', click: withCtrl((c) => c.navigate(settings.get('homepage') || 'arch://newtab')) },
        { type: 'separator' },
        { label: 'История', accelerator: 'CmdOrCtrl+H', click: withCtrl((c) => c.setUIMode('history')) },
        { label: 'Закладки', accelerator: 'CmdOrCtrl+Shift+O', click: withCtrl((c) => c.setUIMode('bookmarks')) },
        { label: 'Добавить страницу в закладки', accelerator: 'CmdOrCtrl+D', click: withCtrl((c) => c.toggleBookmark()) },
        { label: 'Загрузки', accelerator: 'CmdOrCtrl+J', click: withCtrl((c) => c.setUIMode('downloads')) },
        { label: 'Расширения', click: withCtrl((c) => c.setUIMode('extensions')) },
        { label: 'VPN', click: withCtrl((c) => c.setUIMode('vpn')) },
        { label: 'Telegram', accelerator: 'CmdOrCtrl+Shift+M', click: withCtrl((c) => c.toggleTelegram()) },
      ],
    },
    {
      label: 'Справка',
      submenu: [
        {
          label: 'О браузере ArchBrowser',
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: 'ArchBrowser',
              message: 'ArchBrowser',
              detail:
                `Приватный браузер на Chromium ${CHROME_VERSION}\n` +
                `Electron ${process.versions.electron}\n\n` +
                `Блок-лист: ${privacy.blocklistSize.toLocaleString('ru-RU')} доменов\n` +
                `Xray core: ${vpn.coreAvailable() ? 'найден' : 'не найден'}\n\n` +
                'Без телеметрии. Без рекламы. Без слежки.',
              buttons: ['OK'],
            });
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ------------------------------------------------------------------ import
async function importBrowserData(event, { id, tabs = true, passwords: withPasswords = true, bookmarks: withBookmarks = false, history: withHistory = false } = {}) {
  const ctrl = controllerOf(event);
  const detected = importer.detectBrowsers();
  const browser = detected.browsers.find((item) => item.id === id);
  if (!browser) throw new Error('Профиль браузера не найден. Обновите список.');
  const result = importer.readBrowser(browser, {
    tabs: !!tabs && browser.hasTabs,
    passwords: !!withPasswords && browser.hasPasswords,
    bookmarks: !!withBookmarks && browser.hasBookmarks,
    history: !!withHistory && browser.hasHistory,
  });
  let openedTabs = 0;
  let selectedId = null;
  if (tabs && ctrl) {
    const existing = new Set(ctrl.snapshot().tabs.map((tab) => tab.url));
    const fresh = result.tabs.filter((tab) => tab.url && !existing.has(tab.url)).slice(0, 30);
    for (const tab of fresh) {
      const created = ctrl.createTab(tab.url, { active: false });
      if (created) {
        openedTabs++;
        if (!selectedId) selectedId = created.id;
      }
    }
    if (selectedId) ctrl.selectTab(selectedId);
  }
  let passwordResult = { added: 0, duplicate: 0, failed: 0, total: passwords.count() };
  if (withPasswords && result.passwords.length) {
    passwordResult = passwords.addMany(result.passwords, `${browser.name} / ${browser.profile}`);
  }
  let bookmarkResult = { added: 0, duplicate: 0, total: 0 };
  if (withBookmarks && result.bookmarks.length) {
    for (const bm of result.bookmarks) {
      try {
        // В главном процессе обращаемся к хранилищу напрямую: ipcMain.handle
        // недоступен для вызова изнутри процесса.
        const res = bookmarks.add({ url: bm.url, title: bm.title });
        if (res && res.added) bookmarkResult.added++;
        else bookmarkResult.duplicate++;
      } catch {
        bookmarkResult.duplicate++;
      }
    }
    bookmarkResult.total = bookmarkResult.added + bookmarkResult.duplicate;
  }
  let historyResult = { added: 0, total: 0, found: 0 };
  if (withHistory && result.history.length) {
    const res = history.addMany(result.history);
    historyResult.added = res.added;
    historyResult.total = res.total;
    historyResult.found = result.history.length;
  }
  broadcastAll();
  return {
    browser: { name: browser.name, profile: browser.profile },
    tabs: { opened: openedTabs, found: result.tabs.length },
    passwords: passwordResult,
    bookmarks: bookmarkResult,
    history: historyResult,
    skipped: result.skipped || 0,
    appBound: result.appBound || 0,
    warnings: (result.warnings || []).filter((w) => w !== 'app-bound'),
  };
}

// ------------------------------------------------------------------ IPC
function registerIpc() {
  ipcMain.handle('state:get', (e) => controllerOf(e)?.snapshot());
  ipcMain.handle('settings:get', () => settings.all);
  ipcMain.handle('theme:get', () => currentTheme());
  ipcMain.on('theme:get-sync', (e) => {
    e.returnValue = currentTheme();
  });

  // Стартовая страница (arch://newtab) сообщает о таймере и будильнике.
  ipcMain.on('arch:timer-state', (e, state = {}) => {
    let ctrl = null;
    for (const c of controllers) {
      if (c.ownsWebContents && c.ownsWebContents(e.sender)) {
        ctrl = c;
        break;
      }
    }
    if (!ctrl) ctrl = activeController();
    if (ctrl) ctrl.setTimerState(state);
  });

  ipcMain.handle('tabs:create', (e, payload = {}) => {
    const c = controllerOf(e);
    if (!c) return false;
    const tab = c.createTab(
      payload.url || settings.get('newTabPage') || 'arch://newtab',
      { active: payload.active !== false },
    );
    return tab ? tab.id : false;
  });
  ipcMain.handle('tabs:close', (e, { id }) => controllerOf(e)?.closeTab(id));
  ipcMain.handle('settings:open-tab', (e) => controllerOf(e)?.openSettingsTab());
  ipcMain.handle('settings:close-tab', (e) => controllerOf(e)?.closeSettingsTab());
  ipcMain.handle('tabs:select', (e, { id }) => controllerOf(e)?.selectTab(id));
  ipcMain.handle('tabs:reorder', (e, { ids }) => controllerOf(e)?.reorderTabs(ids));
  ipcMain.handle('tabs:context-menu', (e, { id }) => controllerOf(e)?._showTabContextMenu(id));
  ipcMain.handle('menu:popup', (e) => controllerOf(e)?.popupMainMenu());
  ipcMain.handle('menu:titlebar', (e) => controllerOf(e)?.popupTitlebarMenu());
  ipcMain.handle('tabs:share-menu', (e) => controllerOf(e)?.shareCurrentTab());
  ipcMain.handle('tabs:navigate', (e, { url }) => controllerOf(e)?.navigate(url));
  ipcMain.handle('tabs:back', (e) => controllerOf(e)?.goBack());
  ipcMain.handle('tabs:forward', (e) => controllerOf(e)?.goForward());
  ipcMain.handle('tabs:reload', (e) => controllerOf(e)?.reload());
  ipcMain.handle('tabs:reload-hard', (e) => controllerOf(e)?.reloadHard());
  // ------------------------------------------------------------------ подсказки
  ipcMain.handle('suggestions:show', (e, payload = {}) => {
    const ctrl = controllerOf(e);
    if (!ctrl) return false;
    ctrl.showSuggestions(payload.html || '', payload.rect || {});
    return true;
  });
  ipcMain.handle('suggestions:hide', (e) => {
    controllerOf(e)?.hideSuggestions();
    return true;
  });
  ipcMain.on('suggestions:pick', (e, index) => {
    const ctrl = controllerOf(e);
    if (!ctrl) return;
    ctrl.hideSuggestions();
    ctrl.sendCommand('suggestion-pick', { index: Number(index) || 0 });
  });
  ipcMain.on('suggestions:dismiss', (e) => {
    controllerOf(e)?.hideSuggestions();
  });
  ipcMain.on('suggestions:size', (e, height) => {
    controllerOf(e)?.resizeSuggestions(Number(height) || 0);
  });

  ipcMain.handle('tabs:reader-mode', async (e) => {    const ctrl = controllerOf(e);
    if (!ctrl) return false;
    const tab = ctrl.tabs.get(ctrl.activeId);
    if (!tab) return false;
    if (!/^https?:/i.test(tab.url || '')) throw new Error('Режим чтения доступен только на обычных страницах');
    try {
      const result = await tab.wc.executeJavaScript(
        "(() => { if (!window.__archReader) return 'no-reader';"
        + " return window.__archReader.toggle() ? 'on' : 'off'; })()",
      );
      return result === 'on';
    } catch (err) {
      throw new Error('Не удалось включить режим чтения');
    }
  });
  ipcMain.handle('tabs:stop', (e) => controllerOf(e)?.stop());
  ipcMain.handle('tabs:zoom', (e, { delta }) => controllerOf(e)?.zoom(Number(delta) || 0));
  ipcMain.handle('tabs:mute', (e) => controllerOf(e)?.mute());
  ipcMain.handle('tabs:find', (e, payload = {}) => controllerOf(e)?.find(payload.text, payload));
  ipcMain.handle('tabs:stop-find', (e) => controllerOf(e)?.stopFind());
  ipcMain.handle('tabs:focus-page', (e) => controllerOf(e)?.focusPage());
  ipcMain.handle('tabs:bookmark-toggle', (e) => controllerOf(e)?.toggleBookmark());
  ipcMain.handle('ui:mode', (e, { mode }) => controllerOf(e)?.setUIMode(mode));
  ipcMain.handle('ui:overlay', (e, { open } = {}) => {
    controllerOf(e)?.setOverlay(!!open);
    return true;
  });
  ipcMain.handle('ui:context-menu', (e, spec = {}) => controllerOf(e)?.popupContextMenu(spec) ?? null);
  // Уведомления показываются отдельным окном поверх страницы.
  ipcMain.handle('ui:toast', (e, { message, type } = {}) => {
    controllerOf(e)?.showToast(message, type);
    return true;
  });
  // Кнопка «Открыть через VPN» на странице ошибки.
  ipcMain.handle('tab:retry-vpn', async (e, { url } = {}) => {
    const ctrl = controllerOf(e);
    if (!ctrl) return false;
    return ctrl.retryThroughVpn(url);
  });
  ipcMain.handle('ui:chrome-height', (e, { height }) => controllerOf(e)?.setChromeHeight(height));
  ipcMain.handle('ui:chrome-layout', (e, insets = {}) => controllerOf(e)?.setPageInsets(insets));
  ipcMain.handle('ui:media-bar', (e, { visible } = {}) => {
    controllerOf(e)?.setMediaBarVisible(!!visible);
    return true;
  });
  // Контекстное меню адресной строки: буфер обмена доступен только из
  // главного процесса, поэтому вставка/копирование идут через IPC.
  ipcMain.handle('clipboard:read-text', () => clipboard.readText());
  ipcMain.handle('clipboard:write-text', (e, { text } = {}) => {
    clipboard.writeText(String(text || ''));
    return true;
  });
  ipcMain.handle('telegram:toggle', (e, { open } = {}) => {
    controllerOf(e)?.toggleTelegram(typeof open === 'boolean' ? open : undefined);
    return true;
  });
  ipcMain.handle('window:new-private', () => {
    createWindow({ isPrivate: true });
    return true;
  });
  ipcMain.handle('window:new', () => {
    createWindow();
    return true;
  });
  ipcMain.handle('app:quit', () => app.quit());
  ipcMain.handle('app:ready', () => ({ ...bootStatus, totalExtensions: BUNDLED_EXTENSIONS.length }));
  ipcMain.handle('boot:done', () => {
    for (const ctrl of controllers) ctrl.setBootOverlay(false);
    return true;
  });
  ipcMain.handle('window:fullscreen', (e) => controllerOf(e)?.toggleBrowserFullscreen());
  ipcMain.handle('telegram:context-menu', (e) => controllerOf(e)?.popupTelegramMenu());
  ipcMain.handle('telegram:import-proxies', async (e, { limit = 200 } = {}) => {
    const result = await telegramProxies.importAll({ limit });
    broadcastAll();
    return result;
  });
  ipcMain.handle('telegram:proxy-history', () => telegramProxies.history());
  ipcMain.handle('telegram:copy-proxies', async () => {
    const text = await telegramProxies.copyAll();
    clipboard.writeText(text);
    return { count: text.split('\n').filter(Boolean).length };
  });
  ipcMain.handle('import:detect', () => importer.detectBrowsers());
  ipcMain.handle('import:run', (e, payload = {}) => importBrowserData(e, payload));
  // Пароли Chrome 127+ защищены app-bound шифрованием и не читаются из
  // профиля — принимаем CSV, который сам браузер отдаёт при экспорте.
  ipcMain.handle('import:passwords-csv', async (e) => {
    const ctrl = controllerOf(e);
    const options = {
      title: 'Выберите файл экспорта паролей',
      filters: [
        { name: 'Пароли (CSV)', extensions: ['csv'] },
        { name: 'Все файлы', extensions: ['*'] },
      ],
      properties: ['openFile'],
    };
    const win = ctrl && ctrl.window && !ctrl.window.isDestroyed() ? ctrl.window : null;
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (res.canceled || !res.filePaths.length) return { canceled: true };
    try {
      const parsed = importer.readPasswordsCsv(res.filePaths[0]);
      const result = passwords.addMany(parsed.logins, 'CSV');
      broadcastAll();
      return { canceled: false, ...result, warnings: parsed.warnings, file: path.basename(res.filePaths[0]) };
    } catch (err) {
      throw new Error(err.message);
    }
  });
  ipcMain.handle('passwords:list', () => ({
    items: passwords.list(),
    total: passwords.count(),
    locked: passwords.isLocked(),
    hasMaster: passwords.hasMaster(),
  }));
  ipcMain.handle('passwords:unlock', (e, { master } = {}) => {
    passwords.unlock(master || '');
    broadcastAll();
    return { ok: true, total: passwords.count() };
  });
  ipcMain.handle('passwords:lock', () => {
    passwords.lock();
    broadcastAll();
    return true;
  });
  ipcMain.handle('passwords:auto-lock', (e, { minutes } = {}) => {
    passwords.setAutoLockMinutes(minutes);
    return { minutes: passwords.getAutoLockMinutes() };
  });
  ipcMain.handle('passwords:master', (e, { master, current, remove } = {}) => {
    if (remove) passwords.removeMasterPassword(current || '');
    else passwords.setMasterPassword(master || '', current);
    passwords.setAutoLockMinutes(settings.get('passwordAutoLockMinutes'));
    broadcastAll();
    return { ok: true, hasMaster: passwords.hasMaster() };
  });
  ipcMain.handle('passwords:copy', (e, { id } = {}) => {
    const value = passwords.password(id);
    if (!value) return false;
    clipboard.writeText(value);
    return true;
  });
  ipcMain.handle('passwords:remove', (e, { id } = {}) => {
    const result = passwords.remove(id);
    broadcastAll();
    return result;
  });
  ipcMain.handle('passwords:clear', () => {
    passwords.clear();
    broadcastAll();
    return true;
  });
  ipcMain.handle('passwords:fill', async (e, { id } = {}) => {
    const ctrl = controllerOf(e);
    const tab = ctrl ? ctrl.tabs.get(ctrl.activeId) : null;
    const item = passwords.get(id);
    const value = passwords.password(id);
    if (!ctrl || !tab || !item || !value) return false;
    let pageHost = '';
    let loginHost = '';
    try {
      pageHost = new URL(tab.url).hostname;
      loginHost = new URL(item.origin).hostname;
    } catch {}
    if (!pageHost || pageHost !== loginHost) {
      throw new Error(`Пароль сохранён для ${loginHost || item.origin}, а открыт ${pageHost || tab.url}`);
    }
    const code = `(() => {
      const username = ${JSON.stringify(item.username)};
      const password = ${JSON.stringify(value)};
      const setValue = (el, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const passwordInput = document.querySelector('input[type="password"]:not([disabled])');
      if (!passwordInput) return false;
      const form = passwordInput.form || passwordInput.closest('form') || document;
      const userInput = form.querySelector('input[autocomplete="username"],input[type="email"],input[name*="user" i],input[id*="user" i],input[name*="login" i],input[id*="login" i],input[type="text"]');
      if (userInput) setValue(userInput, username);
      setValue(passwordInput, password);
      passwordInput.focus();
      return true;
    })()`;
    return tab.wc.executeJavaScript(code, true);
  });

  ipcMain.handle('settings:set', (e, patch = {}) => {
    const allowed = new Set(Object.keys(DEFAULTS));
    const next = {};
    for (const [key, value] of Object.entries(patch)) {
      if (allowed.has(key)) next[key] = value;
    }
    settings.set(next);
    if ('webrtcLeakProtection' in next) {
      for (const c of controllers) {
        for (const tab of c.tabs.values()) {
          try {
            tab.wc.setWebRTCIPHandlingPolicy(next.webrtcLeakProtection ? 'disable_non_proxied_udp' : 'default');
          } catch {}
        }
      }
    }
    if ('vpnBypassRu' in next) {
      vpn.refreshProxy().catch((err) => console.error('[vpn] bypass:', err.message));
    }
    if ('theme' in next) broadcastTheme();
    if ('rssEnabled' in next) {
      if (next.rssEnabled) rssService.start();
      else rssService.stop();
    }
    broadcastAll();
    return settings.all;
  });
  ipcMain.handle('settings:restart', () => {
    app.relaunch();
    app.exit(0);
  });

  ipcMain.handle('vpn:status', () => vpn.status());
  ipcMain.handle('vpn:add', (e, { text } = {}) => vpn.addFromText(text || ''));
  ipcMain.handle('vpn:add-subscription', async (e, { url } = {}) => vpn.addSubscription(url));
  ipcMain.handle('vpn:remove', (e, { id } = {}) => vpn.removeServer(id));
  ipcMain.handle('vpn:select', (e, { id } = {}) => vpn.selectServer(id));
  ipcMain.handle('vpn:connect', async (e, { id } = {}) => vpn.connect(id));
  ipcMain.handle('vpn:disconnect', async () => vpn.disconnect());
  ipcMain.handle('vpn:test', async (e, { id } = {}) => vpn.testLatency(id));
  ipcMain.handle('vpn:test-connection', async () => vpn.testConnection());

  ipcMain.handle('extensions:list', () => extensions.list());
  ipcMain.handle('extensions:pick', async (e) => {
    const c = controllerOf(e);
    return extensions.pickAndLoad(mainSession, c ? c.window : undefined);
  });
  ipcMain.handle('extensions:remove', async (e, { folder } = {}) => extensions.remove(mainSession, folder));
  ipcMain.handle('extensions:toggle', async (e, { folder, enabled } = {}) =>
    extensions.setEnabled(mainSession, folder, !!enabled),
  );
  ipcMain.handle('extensions:open-folder', () => shell.openPath(extensions.dir));

  ipcMain.handle('bookmarks:list', () => bookmarks.items);
  ipcMain.handle('bookmarks:tree', () => bookmarks.tree());
  ipcMain.handle('favicons:get', () => faviconStore.get('byHost') || {});
  ipcMain.handle('bookmarks:add', (e, payload = {}) => {
    const result = bookmarks.add(payload);
    broadcastAll();
    return result;
  });
  ipcMain.handle('bookmarks:folder-add', (e, payload = {}) => {
    const folder = bookmarks.addFolder(payload);
    broadcastAll();
    return folder;
  });
  ipcMain.handle('bookmarks:folder-rename', (e, { id, name } = {}) => {
    bookmarks.renameFolder(id, name);
    broadcastAll();
    return true;
  });
  ipcMain.handle('bookmarks:folder-remove', (e, { id } = {}) => {
    bookmarks.removeFolder(id);
    broadcastAll();
    return true;
  });
  ipcMain.handle('bookmarks:move', (e, { id, folderId } = {}) => {
    bookmarks.moveBookmark(id, folderId);
    broadcastAll();
    return true;
  });
  ipcMain.handle('bookmarks:update', (e, { id, title, url, folderId } = {}) => {
    const result = bookmarks.update(id, { title, url, folderId });
    broadcastAll();
    return result;
  });
  ipcMain.handle('bookmarks:remove', (e, { id } = {}) => {
    bookmarks.remove(id);
    broadcastAll();
    return true;
  });

  // ------------------------------------------------------------------ медиа
  ipcMain.on('media:detected', (e, payload = {}) => {
    mediaManager.add(payload.url, payload);
  });
  ipcMain.handle('media:list', () => ({
    items: mediaManager.list(),
    jobs: mediaManager.jobsList(),
    available: mediaManager.available(),
  }));
  ipcMain.handle('media:clear', () => {
    mediaManager.clear();
    return true;
  });
  ipcMain.handle('media:page-info', (e) => {
    const ctrl = controllerOf(e);
    const tab = ctrl ? ctrl.tabs.get(ctrl.activeId) : null;
    const url = tab ? tab.url : '';
    return {
      url,
      title: tab ? tab.title : '',
      video: isVideoHost(url),
      music: isMusicHost(url),
    };
  });

  // ------------------------------------------------------------------ плеер
  ipcMain.on('media:page-state', (e, state = {}) => {
    playerService.setPageState(state);
  });
  ipcMain.handle('player:list', (e, { query = '', offset = 0, limit = 200 } = {}) => {
    const page = playerService.page(query, offset, limit);
    return {
      ...playerService.summary(),
      ...page,
      page: playerService.pageState,
      enabled: playerService.enabled(),
      controller: playerService.controllerEnabled(),
    };
  });
  ipcMain.handle('player:add', async (e) => {
    const ctrl = controllerOf(e);
    const win = ctrl && ctrl.window && !ctrl.window.isDestroyed() ? ctrl.window : null;
    return playerService.addFromDialog(win);
  });
  ipcMain.handle('player:add-folder', async (e) => {
    const ctrl = controllerOf(e);
    const win = ctrl && ctrl.window && !ctrl.window.isDestroyed() ? ctrl.window : null;
    return playerService.addFoldersFromDialog(win, (progress) => {
      if (ctrl) ctrl.sendCommand('player-scan', progress);
    });
  });
  ipcMain.handle('player:track', (e, { id } = {}) => playerService.track(id));
  ipcMain.handle('player:next', (e, { id, shuffle, direction, wrap } = {}) => playerService.next(id, { shuffle, direction, wrap }));
  ipcMain.handle('player:start', (e, { shuffle } = {}) => playerService.start({ shuffle }));
  ipcMain.handle('player:previous', (e, { id } = {}) => playerService.previous(id));
  ipcMain.handle('player:remember', (e, { id } = {}) => playerService.remember(id));
  ipcMain.handle('player:notify-track', (e, { title, body } = {}) => trackNotification(title, body));
  ipcMain.handle('player:metadata', (e, { id } = {}) => playerService.readMetadata(id));
  ipcMain.handle('player:remove', (e, { id } = {}) => {
    playerService.remove(id);
    return true;
  });
  ipcMain.handle('player:clear', () => {
    playerService.clear();
    return true;
  });
  ipcMain.handle('player:control', async (e, { action } = {}) => {
    const ctrl = controllerOf(e);
    if (!ctrl) throw new Error('Нет активного окна');
    const tab = ctrl.tabs.get(ctrl.activeId);
    if (!tab) throw new Error('Нет активной вкладки');
    await playerService.pageControl(action, tab.wc);
    return true;
  });

  // ------------------------------------------------------------------ torrent
  const pickTorrentDir = async (win) => {
    const options = {
      title: 'Куда сохранять торрент?',
      buttonLabel: 'Сохранять сюда',
      defaultPath: settings.get('torrentDir') || settings.get('downloadDir') || path.join(os.homedir(), 'Downloads'),
      properties: ['openDirectory', 'createDirectory'],
    };
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (res.canceled || !res.filePaths.length) return '';
    // Запоминаем выбор: в следующий раз диалог откроется в этой папке.
    settings.set({ torrentDir: res.filePaths[0] });
    return res.filePaths[0];
  };

  ipcMain.handle('torrent:list', () => ({
    jobs: torrentService.list(),
    stats: torrentService.stats(),
    enabled: torrentService.enabled(),
    settings: torrentService.settings(),
  }));
  ipcMain.handle('torrent:details', (e, { id } = {}) => torrentService.details(id));
  ipcMain.handle('torrent:add-file', async (e) => {
    const ctrl = controllerOf(e);
    const win = ctrl && ctrl.window && !ctrl.window.isDestroyed() ? ctrl.window : null;
    const options = {
      title: 'Выберите файл .torrent',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Торренты', extensions: ['torrent'] }],
    };
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (res.canceled || !res.filePaths.length) return { canceled: true, ids: [] };
    const dir = await pickTorrentDir(win);
    if (!dir) return { canceled: true, ids: [] };
    const ids = [];
    for (const file of res.filePaths) {
      ids.push(await torrentService.add({ kind: 'file', value: file }, { dir }));
    }
    return { canceled: false, ids };
  });
  ipcMain.handle('torrent:add-magnet', async (e, { magnet } = {}) => {
    const ctrl = controllerOf(e);
    const win = ctrl && ctrl.window && !ctrl.window.isDestroyed() ? ctrl.window : null;
    const value = String(magnet || '').trim();
    if (!value) throw new Error('Пустая ссылка на торрент');
    const dir = await pickTorrentDir(win);
    if (!dir) return { canceled: true, id: '' };
    const id = /^magnet:/i.test(value)
      ? await torrentService.add({ kind: 'magnet', value }, { dir })
      : await torrentService.addUrl(value, { dir });
    return { canceled: false, id };
  });
  ipcMain.handle('torrent:pause', (e, { id } = {}) => {
    torrentService.pause(id);
    return true;
  });
  ipcMain.handle('torrent:resume', (e, { id } = {}) => {
    torrentService.resume(id);
    return true;
  });
  ipcMain.handle('torrent:remove', async (e, { id, deleteData = false } = {}) => {
    await torrentService.remove(id, { deleteData: !!deleteData });
    return true;
  });
  ipcMain.handle('torrent:pause-all', () => {
    torrentService.pauseAll();
    return true;
  });
  ipcMain.handle('torrent:resume-all', () => {
    torrentService.resumeAll();
    return true;
  });
  ipcMain.handle('torrent:set-files', (e, { id, files } = {}) => {
    torrentService.setFiles(id, Array.isArray(files) ? files : []);
    return true;
  });
  ipcMain.handle('torrent:choose-dir', async (e) => {
    const ctrl = controllerOf(e);
    const win = ctrl && ctrl.window && !ctrl.window.isDestroyed() ? ctrl.window : null;
    const options = {
      title: 'Папка для загрузок BitTorrent',
      properties: ['openDirectory', 'createDirectory'],
    };
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (res.canceled || !res.filePaths.length) return { canceled: true };
    settings.set({ torrentDir: res.filePaths[0] });
    return { canceled: false, dir: res.filePaths[0] };
  });
  ipcMain.handle('torrent:open-dir', async (e, { id } = {}) => {
    const dir = torrentService.downloadDir(id);
    if (dir) await shell.openPath(dir);
  });
  ipcMain.handle('torrent:reveal', (e, { id } = {}) => {
    const file = torrentService.firstFile(id);
    if (file) shell.showItemInFolder(file);
    else if (torrentService.downloadDir(id)) shell.openPath(torrentService.downloadDir(id));
  });

  // ------------------------------------------------------------------ rss
  ipcMain.handle('rss:list', () => ({
    feeds: rssService.feeds(),
    items: rssService.items().slice(0, 60),
    enabled: rssService.isEnabled(),
  }));
  ipcMain.handle('rss:add', async (e, { url, title } = {}) => {
    const feed = await rssService.add(url, title);
    await rssService.refresh().catch(() => {});
    return feed;
  });
  ipcMain.handle('rss:remove', (e, { id } = {}) => {
    rssService.remove(id);
    return true;
  });
  ipcMain.handle('rss:rename', (e, { id, title } = {}) => {
    rssService.rename(id, title);
    return true;
  });
  ipcMain.handle('rss:refresh', async () => {
    await rssService.refresh();
    return { count: rssService.items().length };
  });

  // ------------------------------------------------------------------ темы
  ipcMain.handle('themes:list', () => ({
    themes: THEME_IDS.map((id) => ({ id, title: THEMES[id].title })),
    current: currentTheme().name,
  }));

  ipcMain.handle('history:list', (e, { query = '', limit = 300 } = {}) => history.search(query, limit));
  ipcMain.handle('history:clear', () => {
    history.clear();
    broadcastAll();
    return true;
  });

  ipcMain.handle('downloads:list', () => downloads);
  ipcMain.handle('downloads:open', async (e, { id } = {}) => {
    const rec = downloads.find((d) => d.id === id);
    if (rec && rec.path) await shell.openPath(rec.path);
  });
  ipcMain.handle('downloads:show', (e, { id } = {}) => {
    const rec = downloads.find((d) => d.id === id);
    if (rec && rec.path) shell.showItemInFolder(rec.path);
  });
  ipcMain.handle('downloads:clear', () => {
    for (let i = downloads.length - 1; i >= 0; i--) {
      if (downloads[i].state !== 'progressing') downloads.splice(i, 1);
    }
    broadcastAll();
    return downloads;
  });
  ipcMain.handle('downloads:pick-dir', async (e) => {
    const ctrl = controllerOf(e);
    const win = ctrl && ctrl.window && !ctrl.window.isDestroyed() ? ctrl.window : null;
    const options = {
      title: 'Папка для загрузок',
      properties: ['openDirectory', 'createDirectory'],
    };
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (res.canceled || !res.filePaths.length) return { canceled: true };
    return { canceled: false, directory: res.filePaths[0] };
  });
  ipcMain.handle('downloads:open-dir', async () => {
    const { dir } = ensureDownloadDir();
    await shell.openPath(dir);
    return dir;
  });
  ipcMain.handle('downloads:cancel', (e, { id } = {}) => {
    const item = downloadItems.get(id);
    if (item) {
      try {
        item.cancel();
      } catch {}
    }
    return true;
  });
  ipcMain.handle('downloads:pause', (e, { id } = {}) => {
    const item = downloadItems.get(id);
    if (item) {
      try {
        item.pause();
      } catch {}
      const rec = downloads.find((d) => d.id === id);
      if (rec) rec.paused = true;
      broadcastAll();
    }
    return true;
  });
  ipcMain.handle('downloads:resume', (e, { id } = {}) => {
    const item = downloadItems.get(id);
    if (item) {
      try {
        item.resume();
      } catch {}
      const rec = downloads.find((d) => d.id === id);
      if (rec) rec.paused = false;
      broadcastAll();
    }
    return true;
  });

  ipcMain.handle('privacy:stats', (e) => {
    const c = controllerOf(e);
    const tab = c ? c.tabs.get(c.activeId) : null;
    return {
      ...privacy.getStats(tab ? tab.wc.id : undefined),
      blocklistSize: privacy.blocklistSize,
      settings: settings.all,
    };
  });
  ipcMain.handle('privacy:clear', async (e, payload = {}) => {
    const ses = mainSession;
    if (ses) {
      await ses.clearStorageData({
        storages: [
          'cookies',
          'localstorage',
          'indexdb',
          'serviceworkers',
          'cachestorage',
          'shadercache',
          'websql',
          'fileSystems',
        ],
      });
      await ses.clearCache();
      await ses.clearAuthCache().catch(() => {});
    }
    if (payload.history) history.clear();
    if (payload.downloads) {
      for (let i = downloads.length - 1; i >= 0; i--) {
        if (downloads[i].state !== 'progressing') downloads.splice(i, 1);
      }
    }
    broadcastAll();
    return true;
  });

  ipcMain.handle('app:info', () => ({
    app: APP_VERSION,
    chrome: CHROME_VERSION,
    electron: process.versions.electron,
    xray: vpn.coreAvailable(),
    blocklist: privacy.blocklistSize,
    userData: USER_DATA_DIR,
    extensionsDir: extensions.dir,
  }));
  ipcMain.handle('app:open-external', (e, { url } = {}) => {
    if (/^https?:\/\//i.test(url || '')) return shell.openExternal(url);
    return false;
  });
}

// ------------------------------------------------------------------ startup
const BUNDLED_EXTENSIONS = [
  ['ublock-origin/uBlock0.chromium', 'uBlock0.chromium'],
  ['autoscroll', 'autoscroll'],
  ['pip', 'pip'],
  ['privacy-manager', 'privacy-manager'],
  ['return-youtube-dislike', 'return-youtube-dislike'],
  ['shazam', 'shazam'],
  ['ublock-origin-lite', 'ublock-origin-lite'],
  ['user-agent-switcher', 'user-agent-switcher'],
  ['vk-music-saver', 'vk-music-saver'],
  ['vpn-youtube', 'vpn-youtube'],
  ['yandex-search', 'yandex-search'],
  ['https-everywhere', 'https-everywhere'],
  ['privacy-badger', 'privacy-badger'],
  ['volume-master', 'volume-master'],
  ['turn-off-the-lights', 'turn-off-the-lights'],
];

function sendBootProgress() {
  for (const ctrl of controllers) ctrl.sendCommand('boot-progress', bootStatus);
}

async function prepareBundledExtensions() {
  bootStatus = { ready: false, phase: 'Установка расширений', done: 0, total: BUNDLED_EXTENSIONS.length };
  sendBootProgress();
  let extensionsUpdated = false;
  for (const [source, folder] of BUNDLED_EXTENSIONS) {
    try {
      if (extensions.installBundled(path.join(RESOURCES_DIR, 'extensions', source), folder)) {
        extensionsUpdated = true;
      }
    } catch (err) {
      console.warn(`[extensions] не удалось установить ${folder}:`, err.message);
    }
    bootStatus.done++;
    sendBootProgress();
  }

  // Chromium кеширует код service worker'ов по неизменной версии расширения.
  // После обновления встроенных файлов сбрасываем кеш, иначе продолжают
  // работать старые скрипты с несовместимыми API.
  if (extensionsUpdated) {
    try {
      const storagePath = mainSession.getStoragePath?.();
      const cacheDirs = [path.join(USER_DATA_DIR, 'Code Cache')];
      if (storagePath) {
        cacheDirs.push(
          path.join(storagePath, 'Service Worker'),
          path.join(storagePath, 'Code Cache'),
        );
      }
      for (const dir of cacheDirs) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch (err) {
      console.warn('[extensions] не удалось сбросить кеш:', err.message);
    }
  }

  bootStatus.phase = 'Загрузка расширений';
  sendBootProgress();
  try {
    await extensions.loadAll(mainSession);
  } catch (err) {
    console.warn('[extensions] loadAll:', err.message);
  }

  bootReady = true;
  bootStatus = {
    ready: true,
    phase: 'Готово',
    done: BUNDLED_EXTENSIONS.length,
    total: BUNDLED_EXTENSIONS.length,
  };
  broadcastAll();
  for (const ctrl of controllers) {
    ctrl.sendCommand('app-ready', bootStatus);
  }
  // Если UI не успел получить команду (например, окно загружалось дольше),
  // через пару секунд заставка снимается принудительно.
  if (!IS_SMOKE) {
    setTimeout(() => {
      for (const ctrl of controllers) ctrl.setBootOverlay(false);
    }, 2600).unref?.();
  }
  const active = activeController();
  if (active && active.tabs.size) {
    const tab = active.tabs.get(active.activeId);
    if (tab && /^arch:\/\/newtab|^about:blank/i.test(tab.url || '')) {
      try {
        tab.wc.reload();
      } catch {}
    }
  }
}

// ------------------------------------------------------------------ app
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!app.isReady()) return;
    const c = activeController();
    if (c && c.window && !c.window.isDestroyed()) {
      if (c.window.isMinimized()) c.window.restore();
      c.window.show();
      c.window.focus();
    } else {
      createWindow();
    }
  });

  app.whenReady().then(async () => {
    nativeTheme.themeSource = ['light', 'dark', 'system'].includes(THEME_ARG) ? THEME_ARG : 'system';
    // Праздничная тема и её возврат после праздника.
    // Автотема проверяется при старте и сразу после полуночи: праздничная
    // тема выключается на следующий день, а не через случайный час.
    checkHolidayTheme();
    const scheduleHolidayCheck = () => {
      const now = new Date();
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 2);
      const timer = setTimeout(() => {
        checkHolidayTheme();
        scheduleHolidayCheck();
      }, Math.max(1000, next.getTime() - now.getTime()));
      if (timer.unref) timer.unref();
    };
    scheduleHolidayCheck();

    mainSession = session.fromPartition('persist:arch');
    ctx.mainSession = mainSession;
    attachSession(mainSession);
    // Загрузки медиа и RSS идут через ту же сессию: cookies и прокси VPN учитываются.
    if (mediaManager) mediaManager.session = mainSession;
    if (rssService) {
      rssService.session = mainSession;
      rssService.start();
    }

    buildMenu();
    registerIpc();

    // Окно и заставка появляются сразу. Расширения (в первую очередь
    // uBlock) подгружаются параллельно; страница перезагрузится, когда
    // они будут готовы.
    const ctrl = createWindow({ hidden: IS_SMOKE, bootOverlay: !IS_SMOKE });
    ensureTray();

    const extensionsPromise = prepareBundledExtensions();
    if (IS_SMOKE) await extensionsPromise;
    else extensionsPromise.catch((err) => console.error('[startup] extensions:', err.message));

    if (settings.get('vpnAutoConnect')) {
      vpn.connect().catch((err) => console.error('[vpn] auto-connect:', err.message));
    }

    if (IS_SMOKE) {
      const shotDir = app.isPackaged ? path.join(USER_DATA_DIR, 'shots') : path.join(__dirname, '..', 'shots');
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const capture = async (name, wc) => {
        try {
          const image = await wc.capturePage();
          fs.mkdirSync(shotDir, { recursive: true });
          fs.writeFileSync(path.join(shotDir, name), image.toPNG());
          const size = image.getSize();
          console.log(`[SMOKE] shot=${name} ${size.width}x${size.height}`);
        } catch (err) {
          console.log(`[SMOKE] shot-error=${name}:${err.message}`);
        }
      };

      const runSmoke = async () => {
        try {
          const state = ctrl.snapshot();
          const activeWc = ctrl.tabs.get(ctrl.activeId).wc;
          console.log(`[SMOKE] tabs=${state.tabs.length} url=${activeWc.getURL()} title=${activeWc.getTitle()}`);
          console.log(`[SMOKE] blocklist=${privacy.blocklistSize} xray=${vpn.coreAvailable()} chrome=${ctrl.chromeHeight}`);
          const th = currentTheme();
          console.log(`[SMOKE] theme=${th.dark ? 'dark' : 'light'} accent=${th.accent} contrast=${th.accentContrast}`);
          console.log(`[SMOKE] ui-js=${await ctrl.window.webContents.executeJavaScript('1+1')}`);
          console.log(
            `[SMOKE] wco=${await ctrl.window.webContents.executeJavaScript(
              "getComputedStyle(document.documentElement).getPropertyValue('--wco-width') + '|' + !!navigator.windowControlsOverlay",
            )}`,
          );
          const themeBefore = await ctrl.window.webContents.executeJavaScript(
            "document.documentElement.dataset.theme",
          );
          nativeTheme.themeSource = themeBefore === 'dark' ? 'light' : 'dark';
          await new Promise((resolve) => setTimeout(resolve, 400));
          const themeAfter = await ctrl.window.webContents.executeJavaScript(
            "document.documentElement.dataset.theme",
          );
          console.log(`[SMOKE] theme-live=${themeBefore}->${themeAfter}`);
          nativeTheme.themeSource = ['light', 'dark', 'system'].includes(THEME_ARG) ? THEME_ARG : 'system';
          await new Promise((resolve) => setTimeout(resolve, 400));

          // Темы оформления применяются к интерфейсу и к новой вкладке.
          // Светлый/тёмный режим проверяем отдельно от темы.
          try {
            const cases = [
              ['original', 'dark'],
              ['accent', 'light'],
              ['cyberpunk', 'dark'],
              ['newyear', 'light'],
              ['winter', 'dark'],
              ['summer', 'light'],
              ['autumn', 'dark'],
              ['spring', 'light'],
              ['silver', 'dark'],
              ['gold', 'dark'],
              ['umbrella', 'dark'],
              ['neon', 'dark'],
              ['amoled', 'dark'],
              ['silenthill', 'dark'],
            ];
            for (const [name, appearance] of cases) {
              settings.set({ theme: name, appearance });
              broadcastTheme();
              await sleep(300);
              const applied = await ctrl.window.webContents.executeJavaScript(
                "(() => { const r = document.documentElement; return r.dataset.theme + '/' + r.dataset.mode; })()",
              );
              if (applied !== `${name}/${appearance}`) {
                console.log(`[SMOKE] theme-mismatch=${name}/${appearance} -> ${applied}`);
              }
            }
            settings.set({ theme: 'cyberpunk', appearance: 'dark' });
            broadcastTheme();
            await sleep(500);
            await capture('theme-cyberpunk.png', ctrl.window.webContents);
            settings.set({ theme: 'newyear', appearance: 'dark' });
            broadcastTheme();
            await sleep(600);
            try {
              const festive = await ctrl.tabs.get(ctrl.activeId).wc.executeJavaScript(
                "(() => { const b = document.getElementById('festive');"
                + " const d = document.getElementById('festive-days');"
                + " return JSON.stringify({ theme: document.documentElement.dataset.theme,"
                + " hidden: b ? b.classList.contains('hidden') : true,"
                + " days: d ? d.textContent : '' }); })()",
              );
              console.log(`[SMOKE] festive=${festive}`);
            } catch (err) {
              console.log(`[SMOKE] festive-error=${err.message}`);
            }
            settings.set({ theme: 'original', appearance: 'system' });
            broadcastTheme();
            await sleep(400);
            console.log('[SMOKE] themes=checked');
          } catch (err) {
            console.log(`[SMOKE] themes-error=${err.message}`);
          }

          // Стартовая страница: часы, пресеты таймера и кнопки «Старт»/«Сброс».
          try {
            await sleep(900);
            const nt = await ctrl.tabs.get(ctrl.activeId).wc.executeJavaScript(
              "(async () => {"
              + " const out = {};"
              + " out.clock = (document.getElementById('clock') || {}).textContent || '';"
              + " out.presets = document.querySelectorAll('#timer-presets .preset').length;"
              + " const min = document.getElementById('timer-min');"
              + " const start = document.getElementById('timer-start');"
              + " const reset = document.getElementById('timer-reset');"
              + " const disp = document.getElementById('timer-display');"
              + " if (min) min.value = '3';"
              + " if (start) start.click();"
              + " await new Promise((r) => setTimeout(r, 300));"
              + " out.started = (disp || {}).textContent || '';"
              + " out.label = (start || {}).textContent || '';"
              + " if (reset) reset.click();"
              + " await new Promise((r) => setTimeout(r, 150));"
              + " out.reset = (disp || {}).textContent || '';"
              + " return out;"
              + "})()",
            );
            console.log(
              `[SMOKE] newtab clock=${nt.clock} presets=${nt.presets} started=${nt.started} label=${nt.label} reset=${nt.reset}`,
            );

            // Запущенный таймер должен показываться в панели инструментов
            // перед кнопкой VPN.
            await ctrl.tabs.get(ctrl.activeId).wc.executeJavaScript(
              "(() => { const s = document.getElementById('timer-start');"
              + " const m = document.getElementById('timer-min');"
              + " if (m) m.value = '7';"
              + " if (s && s.textContent.indexOf('Старт') >= 0) s.click();"
              + " return true; })()",
            );
            await sleep(700);
            const chip = await ctrl.window.webContents.executeJavaScript(
              "(() => { const c = document.getElementById('timer-chip');"
              + " const l = document.getElementById('timer-chip-label');"
              + " const v = document.getElementById('vpn-chip');"
              + " if (!c || !v) return 'missing';"
              + " const cr = c.getBoundingClientRect(); const vr = v.getBoundingClientRect();"
              + " return JSON.stringify({ hidden: c.classList.contains('hidden'),"
              + " label: (l || {}).textContent, beforeVpn: cr.right <= vr.left + 1 }); })()",
            );
            console.log(`[SMOKE] timer-chip=${chip}`);
          } catch (err) {
            console.log(`[SMOKE] newtab-error=${err.message}`);
          }

          // Подсказки адресной строки: отдельное окно той же ширины, поверх страницы.
          try {
            await ctrl.window.webContents.executeJavaScript(
              "(() => { const o = document.getElementById('omnibox');"
              + " o.focus(); o.value = 'go'; o.dispatchEvent(new Event('input')); return true; })()",
            );
            await sleep(1400);
            const popup = ctrl._suggestions;
            if (popup && !popup.isDestroyed()) {
              const geo = await popup.webContents.executeJavaScript(
                "(() => { const w = Number(document.body.dataset.width) || 0;"
                + " const c = document.querySelector('.suggest-row');"
                + " return JSON.stringify({ visible: true, rows: document.querySelectorAll('[data-suggest]').length,"
                + " first: c ? Math.round(c.getBoundingClientRect().width) : null }); })()",
              );
              console.log(`[SMOKE] suggestions-window=${geo}`);
            } else {
              console.log('[SMOKE] suggestions-window=нет окна');
            }
            await ctrl.window.webContents.executeJavaScript(
              "(() => { const o = document.getElementById('omnibox'); o.value = ''; o.blur(); return true; })()",
            );
            await sleep(300);
          } catch (err) {
            console.log(`[SMOKE] omnibox-error=${err.message}`);
          }

          // Импорт из установленного браузера: закладки и история.
          try {
            const detected = importer.detectBrowsers();
            const profile = detected.browsers.find((b) => b.hasBookmarks);
            if (profile) {
              const res = await importBrowserData(
                { sender: ctrl.window.webContents },
                { id: profile.id, tabs: false, passwords: false, bookmarks: true, history: true },
              );
              console.log(
                `[SMOKE] import bookmarks=${res.bookmarks.added}/${res.bookmarks.total} history=${res.history.added} appBound=${res.appBound}`,
              );
            } else {
              console.log('[SMOKE] import no-profile');
            }
          } catch (err) {
            console.log(`[SMOKE] import-error=${err.message}`);
          }

          // Панель закладок: включаем и проверяем отрисовку.
          try {
            settings.set({ showBookmarksBar: true });
            await sleep(900);
            const bar = await ctrl.window.webContents.executeJavaScript(
              "(() => { const b = document.getElementById('bookmarks-bar');"
              + " if (!b) return 'missing';"
              + " return JSON.stringify({ hidden: b.classList.contains('hidden'),"
              + " height: Math.round(b.getBoundingClientRect().height),"
              + " items: b.querySelectorAll('.bb-item, .bb-folder').length }); })()",
            );
            console.log(`[SMOKE] bookmarks-bar=${bar}`);
            await capture('bookmarks-bar.png', ctrl.window.webContents);
            settings.set({ showBookmarksBar: false });
            await sleep(300);
          } catch (err) {
            console.log(`[SMOKE] bookmarks-bar-error=${err.message}`);
          }

          const sample = parseLink(
            'vless://11111111-1111-1111-1111-111111111111@example.com:443?security=tls&type=ws&path=%2Fws#Test',
          );
          console.log(`[SMOKE] parsed=${sample.protocol}://${sample.address}:${sample.port} net=${sample.network}`);

          // Страничный JS + внедрение антифингерпринтинга.
          const testHtml = path.join(USER_DATA_DIR, 'smoke.html');
          fs.writeFileSync(
            testHtml,
            '<title>before</title><script>setTimeout(function(){document.title="js:"+(window.__archStealth?"yes":"no")},1200)</script>',
          );
          const tab3 = ctrl.createTab(pathToFileURL(testHtml).toString(), { active: false });
          await sleep(2600);
          console.log(`[SMOKE] js-title=${tab3.wc.getTitle()}`);
          ctrl.closeTab(tab3.id);
          fs.rmSync(testHtml, { force: true });

          try {
            const { execFileSync } = require('child_process');
            const xrayVersion = execFileSync(vpn.xrayExe, ['-version'], { encoding: 'utf8' }).split(/\r?\n/)[0];
            console.log(`[SMOKE] xray=${xrayVersion}`);
          } catch (err) {
            console.log(`[SMOKE] xray-version-error=${err.message}`);
          }

          try {
            const tmp = path.join(USER_DATA_DIR, 'smoke-extension');
            fs.mkdirSync(tmp, { recursive: true });
            fs.writeFileSync(
              path.join(tmp, 'manifest.json'),
              JSON.stringify({ manifest_version: 3, name: 'Smoke Test', version: '1.0' }),
            );
            const api = mainSession.extensions || mainSession;
            const ext = await api.loadExtension(tmp, { allowFileAccess: true });
            console.log(`[SMOKE] extension=${ext.name} v${ext.version}`);
            api.removeExtension(ext.id);
            fs.rmSync(tmp, { recursive: true, force: true });
          } catch (err) {
            console.log(`[SMOKE] extension-error=${err.message}`);
          }

          ctrl.window.show();
          await sleep(400);
          await capture('newtab.png', activeWc);

          ctrl.setUIMode('vpn');
          await sleep(600);
          await capture('vpn.png', ctrl.window.webContents);

          ctrl.setUIMode('settings');
          await sleep(500);
          await capture('settings.png', ctrl.window.webContents);

          // Новые разделы настроек: пароли, загрузки.
          try {
            await ctrl.window.webContents.executeJavaScript(
              "(() => { const labels = [...document.querySelectorAll('.section-label')];"
              + " const target = labels.find((l) => /Пароли/.test(l.textContent));"
              + " if (target) target.scrollIntoView({ block: 'start' });"
              + " return !!target; })()",
            );
            await sleep(600);
            await capture('settings-passwords.png', ctrl.window.webContents);
            const downloadsSection = await ctrl.window.webContents.executeJavaScript(
              "(() => { const labels = [...document.querySelectorAll('.section-label')];"
              + " const target = labels.find((l) => /Загрузки/.test(l.textContent));"
              + " if (target) target.scrollIntoView({ block: 'start' });"
              + " return !!target; })()",
            );
            await sleep(600);
            await capture('settings-downloads.png', ctrl.window.webContents);
            console.log(`[SMOKE] settings-downloads-section=${downloadsSection}`);
          } catch (err) {
            console.log(`[SMOKE] settings-sections-error=${err.message}`);
          }

          // Окно импорта: профиль → импорт → итог с предупреждением.
          try {
            await ctrl.window.webContents.executeJavaScript(
              "(() => { const b = document.querySelector('[data-action=\"import-open\"]');"
              + " if (b) b.click(); return !!b; })()",
            );
            await sleep(500);
            await ctrl.window.webContents.executeJavaScript(
              "(() => { const s = document.querySelector('[data-import-scan]'); if (s) s.click(); return true; })()",
            );
            await sleep(2500);
            await ctrl.window.webContents.executeJavaScript(
              "(() => { const r = document.querySelector('[data-import-run]'); if (r) r.click(); return true; })()",
            );
            await sleep(9000);
            const summary = await ctrl.window.webContents.executeJavaScript(
              "(() => { const t = document.getElementById('import-result-text');"
              + " const w = document.getElementById('import-warnings');"
              + " return JSON.stringify({ summary: (t || {}).textContent || '',"
              + " warnRows: w ? w.querySelectorAll('.import-warn-row').length : 0,"
              + " warnHidden: w ? w.classList.contains('hidden') : true }); })()",
            );
            console.log(`[SMOKE] import-modal=${summary}`);
            await capture('import.png', ctrl.window.webContents);
            await ctrl.window.webContents.executeJavaScript(
              "(() => { const c = document.querySelector('[data-import-close-done]'); if (c) c.click(); return true; })()",
            );
          } catch (err) {
            console.log(`[SMOKE] import-modal-error=${err.message}`);
          }

          // Панель должна открываться по кнопке, а главный процесс — убрать
          // страницу из-под панели, иначе раздел не будет виден.
          try {
            await ctrl.window.webContents.executeJavaScript(
              "(() => { const b = document.getElementById('extensions-btn'); if (b) b.click(); return true; })()",
            );
            await sleep(1600);
            // Страница в режиме панели откреплена от окна (см. _attachView).
            const viewVisible = !!ctrl.tabs.get(ctrl.activeId).view.__archAttached;
            const dom = await ctrl.window.webContents.executeJavaScript(
              "(() => { const p = document.getElementById('panel');"
              + " return JSON.stringify({ hidden: p.classList.contains('hidden'),"
              + " title: (document.getElementById('panel-title')||{}).textContent || '' }); })()",
            );
            console.log(`[SMOKE] panel-click-mode=${ctrl.uiMode} view=${viewVisible} dom=${dom}`);
            await ctrl.window.webContents.executeJavaScript(
              "(() => { const c = document.getElementById('panel-close'); if (c) c.click(); return true; })()",
            );
            await sleep(700);
          } catch (err) {
            console.log(`[SMOKE] panel-click-error=${err.message}`);
          }

          // Кнопки панели инструментов: перетаскивание не должно мешать клику.
          try {
            const regions = await ctrl.window.webContents.executeJavaScript(
              "(() => { const ids = ['share-btn','downloads-btn','extensions-btn','vpn-chip','timer-chip'];"
              + " return JSON.stringify(ids.map((id) => { const el = document.getElementById(id);"
              + " return id + '=' + (el ? (getComputedStyle(el).webkitAppRegion || 'none') : 'нет'); })); })()",
            );
            console.log(`[SMOKE] toolbar-regions=${regions}`);
          } catch (err) {
            console.log(`[SMOKE] toolbar-regions-error=${err.message}`);
          }

          // Панели должны открываться по кнопке и не закрываться сами.
          for (const [button, panel] of [['extensions-btn', 'extensions'], ['downloads-btn', 'downloads']]) {
            try {
              await ctrl.window.webContents.executeJavaScript(
                `(() => { const b = document.getElementById('${button}'); if (b) b.click(); return true; })()`,
              );
              await sleep(1800);
              const state = await ctrl.window.webContents.executeJavaScript(
                "(() => { const p = document.getElementById('panel');"
                + " const t = document.getElementById('panel-title');"
                + " return JSON.stringify({ hidden: p.classList.contains('hidden'),"
                + " title: t ? t.textContent : '' }); })()",
              );
              console.log(`[SMOKE] panel-${panel}=${state}`);
            } catch (err) {
              console.log(`[SMOKE] panel-${panel}-error=${err.message}`);
            }
          }
          await ctrl.window.webContents.executeJavaScript(
            "(() => { const b = document.getElementById('share-btn'); if (b) b.click(); return true; })()",
          );
          await sleep(600);
          await ctrl.window.webContents.executeJavaScript(
            "(() => { const c = document.getElementById('panel-close'); if (c) c.click(); return true; })()",
          );
          await sleep(400);

          ctrl.setUIMode('extensions');
          await sleep(400);
          await capture('extensions.png', ctrl.window.webContents);

          ctrl.setUIMode('about');
          await sleep(400);
          await capture('about.png', ctrl.window.webContents);

          ctrl.setUIMode('web');
          await sleep(400);
          console.log(`[SMOKE] menu-handler=${typeof ctrl.popupMainMenu === 'function'}`);

          const ublock = (ctrl.snapshot().extensions || []).find(
            (ext) => ext.enabled && /uBlock/i.test(ext.name),
          );
          console.log(
            `[SMOKE] ublock=${ublock ? `${ublock.name} v${ublock.version} options=${ublock.optionsPage}` : 'missing'}`,
          );
          if (ublock && ublock.optionsPage) {
            const dashTab = ctrl.createTab(
              `chrome-extension://${ublock.id}/${ublock.optionsPage}`,
              { active: true },
            );
            await sleep(2200);
            console.log(
              `[SMOKE] ublock-dashboard=${dashTab.wc.getTitle()} url=${dashTab.wc.getURL()}`,
            );
            await capture('ublock-dashboard.png', dashTab.wc);
            ctrl.closeTab(dashTab.id);
          }
          ctrl.openTelegram();
          await sleep(3800);
          console.log(
            `[SMOKE] telegram-open=${ctrl.snapshot().telegramOpen} width=${ctrl._telegramVisibleWidth()} loaded=${ctrl.telegram ? ctrl.telegram.wc.getURL() : 'none'} title=${ctrl.telegram ? ctrl.telegram.wc.getTitle() : ''} loading=${ctrl.telegram ? ctrl.telegram.wc.isLoading() : '?'}`,
          );
          await capture('telegram.png', ctrl.window.webContents);
          if (ctrl.telegram) await capture('telegram-page.png', ctrl.telegram.wc);
          ctrl.closeTelegram();
          await sleep(350);
          console.log(`[SMOKE] telegram-closed=${!ctrl.snapshot().telegramOpen} width=${ctrl._telegramVisibleWidth()}`);

          // ---- UI-взаимодействия: вкладки, настройки, импорт VPN ----
          const uiEval = (code) => ctrl.window.webContents.executeJavaScript(code);
          const tabCount = () => uiEval('document.querySelectorAll("#tabs .tab").length');

          const tabsBefore = await tabCount();
          await uiEval('document.querySelector("#new-tab-btn").click()');
          await sleep(600);
          const tabsAfter = await tabCount();
          console.log(`[SMOKE] ui-new-tab=${tabsBefore}->${tabsAfter}`);
          await uiEval('document.querySelectorAll("#tabs .tab")[1].querySelector(".tab-close").click()');
          await sleep(400);
          console.log(`[SMOKE] ui-close-tab=${await tabCount()}`);

          ctrl.setUIMode('settings');
          await sleep(500);
          const blockBefore = await uiEval('document.querySelector(\'input[data-setting="blockAds"]\').checked');
          await uiEval('document.querySelector(\'input[data-setting="blockAds"]\').click()');
          await sleep(400);
          const blockAfter = settings.get('blockAds');
          console.log(`[SMOKE] ui-setting-blockAds=${blockBefore}->${blockAfter}`);
          await uiEval('document.querySelector(\'input[data-setting="blockAds"]\').click()');
          await sleep(300);

          ctrl.setUIMode('vpn');
          await sleep(500);
          await uiEval(`(() => {
            document.querySelector('#vpn-link').value = 'socks://user:pass@127.0.0.1:9999#SmokeServer';
            document.querySelector('[data-vpn="add-link"]').click();
          })()`);
          await sleep(700);
          const rowCount = await uiEval('document.querySelectorAll(".server-row").length');
          console.log(`[SMOKE] ui-vpn-import=${rowCount} row(s)`);
          const autoBefore = settings.get('vpnAutoConnect');
          await uiEval('document.querySelector("[data-vpn-auto]").click()');
          await sleep(500);
          console.log(`[SMOKE] ui-vpn-auto=${autoBefore}->${settings.get('vpnAutoConnect')}`);
          await uiEval('document.querySelector("[data-vpn-auto]").click()');
          await sleep(300);
          const smokeServer = vpn.servers().find((s) => s.name === 'SmokeServer');
          if (smokeServer) vpn.removeServer(smokeServer.id);

          ctrl.setUIMode('web');
          await sleep(300);
          await uiEval(`(() => {
            const box = document.querySelector('#omnibox');
            box.value = 'vless://11111111-1111-1111-1111-111111111111@example.com:443?security=tls#OmniTest';
            box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          })()`);
          await sleep(800);
          const omniServer = vpn.servers().find((s) => s.name === 'OmniTest');
          console.log(`[SMOKE] ui-proxy-link=${omniServer ? 'imported' : 'missing'}`);
          if (omniServer) vpn.removeServer(omniServer.id);
          ctrl.setUIMode('web');
          await sleep(300);

          const tab2 = ctrl.createTab('https://example.com', { active: true });
          await new Promise((resolve) => {
            const timer = setTimeout(resolve, 9000);
            tab2.wc.once('did-stop-loading', () => {
              clearTimeout(timer);
              resolve();
            });
          });
          console.log(`[SMOKE] example=${tab2.wc.getURL()} title=${tab2.wc.getTitle()}`);
          await capture('example.png', tab2.wc);

          // Подсказки адресной строки показываются отдельным окном поверх страницы.
          try {
            await ctrl.window.webContents.executeJavaScript(
              "(() => { const o = document.getElementById('omnibox'); o.focus(); o.value = 'пример';"
              + " o.dispatchEvent(new Event('input', { bubbles: true })); return true; })()",
            );
            await sleep(1600);
            const popup = ctrl._suggestions;
            console.log(`[SMOKE] suggestions-popup=${popup && !popup.isDestroyed() ? 'shown' : 'нет'} visible=${popup && !popup.isDestroyed() ? popup.isVisible() : false}`);
            if (popup && !popup.isDestroyed()) {
              const rows = await popup.webContents.executeJavaScript(
                "document.querySelectorAll('[data-suggest]').length",
              );
              console.log(`[SMOKE] suggestions-rows=${rows}`);
              popup.hide();
            }
            await ctrl.window.webContents.executeJavaScript(
              "(() => { const o = document.getElementById('omnibox'); o.value = ''; o.blur(); return true; })()",
            );
            await sleep(300);
          } catch (err) {
            console.log(`[SMOKE] suggestions-error=${err.message}`);
          }

          console.log('SMOKE_OK');
          app.exit(0);
        } catch (err) {
          console.error('[SMOKE] FAIL', err);
          app.exit(1);
        }
      };

      setTimeout(runSmoke, 3000);

      setTimeout(() => {
        console.error('[SMOKE] TIMEOUT');
        app.exit(1);
      }, 240000).unref();
    }

    app.on('activate', () => {
      if (controllers.size === 0) createWindow();
    });
  }).catch((err) => {
    logStartup('whenReady:', err);
    console.error('[startup] whenReady:', err);
    try {
      dialog.showErrorBox(
        'ArchBrowser не запустился',
        `${err && err.message ? err.message : err}\n\nПодробности: ${path.join(USER_DATA_DIR, 'startup.log')}`,
      );
    } catch {}
    app.quit();
  });

  app.on('before-quit', (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    (async () => {
      // Страховка: если Xray зависнет, приложение всё равно
      // должно завершиться, а не остаться висеть в фоне.
      const force = setTimeout(() => app.exit(0), 4000);
      try {
        await vpn.shutdown();
        if (playerService) playerService.flush();
        if (torrentService) await torrentService.stopAll();
        if (rssService) rssService.stop();
        if (settings.get('clearOnExit') && mainSession) {
          await mainSession.clearStorageData();
          await mainSession.clearCache();
        }
      } catch (err) {
        console.error('[quit]', err.message);
      }
      clearTimeout(force);
      app.quit();
    })();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

// Экспорт для тестов и встраивания.
module.exports = { ctx, createWindow, get settings() { return settings; }, get bookmarks() { return bookmarks; }, get passwords() { return passwords; }, get media() { return mediaManager; } };
