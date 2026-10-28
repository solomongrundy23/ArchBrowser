'use strict';

const path = require('path');
const { JsonStore } = require('./store');

const SEARCH_ENGINES = {
  duckduckgo: {
    name: 'DuckDuckGo',
    search: 'https://duckduckgo.com/?q=%s&kae=d',
  },
  startpage: {
    name: 'Startpage',
    search: 'https://www.startpage.com/sp/search?query=%s',
  },
  brave: {
    name: 'Brave Search',
    search: 'https://search.brave.com/search?q=%s',
  },
  google: {
    name: 'Google',
    search: 'https://www.google.com/search?q=%s',
  },
  yandex: {
    name: 'Яндекс',
    search: 'https://yandex.ru/search/?text=%s',
  },
};

const DEFAULTS = {
  // Защита
  blockAds: true,
  blockTrackers: true,
  blockThirdPartyCookies: true,
  httpsOnly: true,
  stripTrackingParams: true,
  trimReferrer: true,
  fingerprintProtection: true,
  webrtcLeakProtection: true,
  sendDnt: true,
  doh: true,
  dohServer: 'https://cloudflare-dns.com/dns-query',
  clearOnExit: false,

  // Браузер
  searchEngine: 'duckduckgo',
  homepage: 'arch://newtab',
  newTabPage: 'arch://newtab',
  downloadDir: '',
  // Загрузки: auto — сразу в папку, ask — спрашивать путь каждый раз.
  downloadMode: 'auto',
  downloadNotify: true,
  downloadOpenPrompt: true,
  restoreSession: false,
  tabPosition: 'top',
  // Скрывать кнопки справа от адресной строки, оставляя одну «показать».
  compactToolbar: false,
  // Панель закладок под адресной строкой.
  showBookmarksBar: false,
  // Тема оформления: original, accent, cyberpunk, newyear…
  theme: 'original',
  // Светлый/тёмный режим — отдельно от темы: system, light, dark.
  appearance: 'system',
  // Автоматически включать тему праздника за 7 дней до и выключать через
  // 7 дней после, возвращая прежнюю тему.
  holidayThemeAuto: true,
  holidayActiveTheme: '',
  holidayBaseTheme: '',
  holidayBaseAppearance: '',
  // Где показывать мини-плеер: сверху (под панелью) или снизу окна.
  mediaBarPosition: 'top',
  // Полупрозрачные панели с размытием фона (Liquid Glass) на macOS.
  liquidGlass: true,
  // Прозрачность стекла (0 — непрозрачно, 100 — максимально прозрачно).
  glassTransparency: 70,

  // RSS-ленты
  rssEnabled: false,
  rssIntervalMinutes: 30,

  // Дополнительные функции (переключаются в настройках)
  featureLoadingSkeleton: true,
  featureReaderMode: true,
  featureNotifications: false,
  notificationsMode: 'off',
  notificationSites: [],
  featureBittorrent: true,
  featureLocalPlayer: true,
  featureMediaController: true,
  featureTimerPresets: true,

  // Пароли
  passwordAutoLockMinutes: 15,

  // Медиа
  mediaAutoDetect: true,
  // Системное уведомление при начале новой композиции.
  trackNotify: true,

  // BitTorrent (встроенный клиент)
  torrentDir: '',
  torrentPort: 51413,
  torrentMaxPeers: 60,
  torrentUploadSlots: 10,
  torrentDht: true,
  torrentUseTrackers: true,
  torrentSeedRatio: 2,
  torrentResumeOnStart: true,
  torrentStartPaused: false,

  // VPN
  vpnAutoConnect: false,
  vpnServerId: null,
  vpnSocksPort: 10808,
  vpnHttpPort: 10809,
  // Домены .ru и .рф идут напрямую, минуя VPN.
  vpnBypassRu: true,

  // Расширения (пути, отключённые пользователем)
  disabledExtensions: [],

  // Служебное
  firstRun: true,
};

class Settings extends JsonStore {
  constructor(userDataDir, onChange) {
    super(path.join(userDataDir, 'settings.json'), DEFAULTS);
    // Любое изменение настроек из главного процесса должно доходить до
    // интерфейса, иначе панели остаются в устаревшем состоянии.
    this.onChange = typeof onChange === 'function' ? onChange : null;
  }

  set(patch) {
    const result = super.set(patch);
    if (this.onChange) {
      try {
        this.onChange(patch);
      } catch (err) {
        console.error('[settings] change hook:', err.message);
      }
    }
    return result;
  }

  searchUrl(query) {
    const engine = SEARCH_ENGINES[this.data.searchEngine] || SEARCH_ENGINES.duckduckgo;
    return engine.search.replace('%s', encodeURIComponent(query));
  }
}

module.exports = { Settings, SEARCH_ENGINES, DEFAULTS };
