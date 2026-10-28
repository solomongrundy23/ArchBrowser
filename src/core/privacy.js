'use strict';

const fs = require('fs');
const path = require('path');
const { webContents } = require('electron');

// Домены верхнего уровня, состоящие из двух частей (упрощённый PSL).
const SECOND_LEVEL = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'net.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp',
  'com.br', 'net.br', 'org.br', 'gov.br',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn',
  'com.tr', 'net.tr', 'org.tr', 'gov.tr',
  'co.kr', 'or.kr', 'go.kr',
  'co.in', 'net.in', 'org.in', 'gov.in',
  'com.mx', 'com.ar', 'com.co', 'com.pe', 'com.ve', 'com.ec',
  'com.sg', 'com.hk', 'com.tw', 'com.my', 'com.ph', 'com.pk', 'com.bd',
  'co.id', 'or.id', 'go.id', 'co.za', 'org.za', 'com.ua', 'co.il', 'org.il',
  'com.pl', 'net.pl', 'org.pl', 'com.es', 'com.pt', 'com.gr', 'com.cz',
  'co.nz', 'net.nz', 'org.nz', 'co.th', 'in.th', 'go.th',
]);

const TELEMETRY_HEADERS = new Set(['x-client-data', 'x-google-client-data']);

// Рекламные пути на «первопартийных» доменах: блокировка по домену их не
// ловит (yandex.ru/ads/…, yastatic.net/adfox/…), а uBlock на таких страницах
// иногда не успевает применить правила. Отсекаем сами запросы.
const AD_URL_PATTERNS = [
  /^https?:\/\/([a-z0-9-]+\.)*yandex\.[a-z.]+\/(ads|an|adfox)\//i,
  /^https?:\/\/an\.yandex\./i,
  /^https?:\/\/ads\.yandex\./i,
  /^https?:\/\/yabs\.yandex\./i,
  /^https?:\/\/([a-z0-9-]+\.)*yastatic\.net\/.*(adfox|banners|direct-ads)/i,
  /^https?:\/\/([a-z0-9-]+\.)*google\.[a-z.]+\/(pagead|ads)\//i,
  /^https?:\/\/([a-z0-9-]+\.)*(doubleclick\.net|googleadservices\.com|googlesyndication\.com)\//i,
  /^https?:\/\/([a-z0-9-]+\.)*adfox\.(ru|me)\//i,
  /^https?:\/\/([a-z0-9-]+\.)*adriver\.ru\//i,
];

function isAdUrl(url) {
  return AD_URL_PATTERNS.some((re) => re.test(url));
}

// Подсказки клиента (Client Hints): Electron присылает Sec-CH-UA без бренда
// «Google Chrome», и антибот-системы принимают это за бота. Приводим к Chrome.
const CHROME_FULL = String((process.versions && process.versions.chrome) || '152.0.0.0');
const CHROME_MAJOR = CHROME_FULL.split('.')[0] || '152';
const CH_BRANDS = `"Not)A;Brand";v="24", "Chromium";v="${CHROME_MAJOR}", "Google Chrome";v="${CHROME_MAJOR}"`;
const CH_FULL_LIST = `"Not)A;Brand";v="24.0.0.0", "Chromium";v="${CHROME_FULL}", "Google Chrome";v="${CHROME_FULL}"`;

function isIp(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

function siteOf(host) {
  if (!host) return '';
  host = host.toLowerCase().replace(/\.$/, '');
  if (isIp(host)) return host;
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const last2 = parts.slice(-2).join('.');
  if (SECOND_LEVEL.has(last2)) return parts.slice(-3).join('.');
  return last2;
}

function isLocalHost(host) {
  if (!host) return false;
  host = host.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '[::1]') return true;
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  return false;
}

function originOf(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/`;
  } catch {
    return null;
  }
}

class Privacy {
  constructor({ resourcesDir, getSettings, onBlocked }) {
    this.resourcesDir = resourcesDir;
    this.getSettings = getSettings;
    this.onBlocked = onBlocked || (() => {});
    this.blocklist = new Set();
    this.blocklistSize = 0;
    this._matchCache = new Map();
    this._installed = new WeakSet();
    this._counters = new Map(); // webContentsId -> { blocked, ads, trackers }
    this._blockedTotal = 0;
    this._pending = null;
    this.loadBlocklists();
  }

  loadBlocklists() {
    const files = ['blocklist.txt', 'blocklist-trackers.txt'];
    for (const file of files) {
      const full = path.join(this.resourcesDir, file);
      let text = '';
      try {
        text = fs.readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      for (let line of text.split(/\r?\n/)) {
        line = line.trim();
        if (!line || line.startsWith('#') || line.startsWith('!') || line.startsWith('//')) continue;
        // Поддержка форматов: домен, 0.0.0.0 домен, ||домен^, *.домен
        let host = line;
        if (host.includes(' ') || host.includes('\t')) {
          const parts = host.split(/\s+/);
          host = parts.find((p) => p.includes('.')) || '';
        }
        host = host.replace(/^\|\|/, '').replace(/\^$/, '').replace(/^\*\./, '').replace(/^\.+/, '');
        if (!host || host.includes('/') || host.includes('*')) continue;
        if (!/^[a-z0-9.-]+$/i.test(host)) continue;
        if (!host.includes('.')) continue;
        this.blocklist.add(host.toLowerCase());
      }
    }
    this.blocklistSize = this.blocklist.size;
    console.log(`[privacy] blocklist: ${this.blocklistSize} domains`);
  }

  isBlocked(host) {
    host = host.toLowerCase();
    if (this._matchCache.has(host)) return this._matchCache.get(host);
    let found = false;
    let cur = host;
    while (cur && cur.includes('.')) {
      if (this.blocklist.has(cur)) {
        found = true;
        break;
      }
      const dot = cur.indexOf('.');
      cur = cur.slice(dot + 1);
    }
    if (this._matchCache.size > 20000) this._matchCache.clear();
    this._matchCache.set(host, found);
    return found;
  }

  install(ses) {
    if (this._installed.has(ses)) return;
    this._installed.add(ses);

    ses.setSpellCheckerEnabled(false);

    const telegramOrigin = (url) => {
      try {
        const host = new URL(url).hostname;
        return host === 'telegram.org' || host.endsWith('.telegram.org');
      } catch {
        return false;
      }
    };

    // Всплывающие сообщения с сайтов. Режим задаётся в настройках:
    // off — запрещены всем, allow — разрешены всем, sites — только из списка.
    const notificationAllowed = (origin) => {
      const settings = this.getSettings ? this.getSettings() : {};
      if (settings.featureNotifications === false) return false;
      const mode = settings.notificationsMode || 'off';
      if (mode === 'allow') return true;
      if (mode !== 'sites') return false;
      const list = Array.isArray(settings.notificationSites) ? settings.notificationSites : [];
      let host = '';
      try {
        host = new URL(origin || '').hostname.toLowerCase();
      } catch {
        return false;
      }
      return list.some((entry) => {
        const item = String(entry || '').trim().toLowerCase();
        if (!item) return false;
        if (item === host) return true;
        if (item.startsWith('*.')) return host.endsWith(item.slice(1));
        return host.endsWith(`.${item}`);
      });
    };

    ses.setPermissionRequestHandler((wc, permission, callback, details = {}) => {
      // Разрешаем только безопасные вещи, остальное — отклоняем.
      const telegram = telegramOrigin(details.requestingUrl || wc.getURL());
      if (permission === 'notifications') {
        callback(notificationAllowed(details.requestingUrl || wc.getURL()));
        return;
      }
      const allowed =
        permission === 'fullscreen' ||
        permission === 'clipboard-sanitized-write' ||
        (telegram && (permission === 'clipboard-read'));
      callback(allowed);
    });

    ses.setPermissionCheckHandler((wc, permission, requestingOrigin) => {
      const telegram = telegramOrigin(requestingOrigin || (wc && wc.getURL ? wc.getURL() : ''));
      if (permission === 'notifications') {
        return notificationAllowed(requestingOrigin || (wc && wc.getURL ? wc.getURL() : ''));
      }
      return (
        permission === 'fullscreen' ||
        permission === 'clipboard-sanitized-write' ||
        (telegram && permission === 'clipboard-read')
      );
    });

    ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
      try {
        this._handleRequest(ses, details, callback);
      } catch (err) {
        callback({});
      }
    });

    ses.webRequest.onBeforeSendHeaders({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
      try {
        callback({ requestHeaders: this._hardenHeaders(details) });
      } catch {
        callback({});
      }
    });
  }

  _handleRequest(ses, details, callback) {
    const s = this.getSettings();
    let url;
    try {
      url = new URL(details.url);
    } catch {
      return callback({});
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return callback({});

    const host = url.hostname.toLowerCase();

    // HTTPS-First: апгрейдим только главный фрейм, чтобы не ломать сайты.
    if (s.httpsOnly && url.protocol === 'http:' && details.resourceType === 'mainFrame' && !isLocalHost(host)) {
      const httpsUrl = 'https://' + url.host + url.pathname + url.search + url.hash;
      return callback({ redirectURL: httpsUrl });
    }

    if (details.resourceType === 'mainFrame') return callback({});

    const topUrl = this._topUrl(details);
    const topHost = topUrl ? (() => { try { return new URL(topUrl).hostname.toLowerCase(); } catch { return ''; } })() : '';
    const thirdParty = topHost ? siteOf(topHost) !== siteOf(host) : true;

    if ((s.blockTrackers || s.blockAds) && !isLocalHost(host) && this.isBlocked(host)) {
      this._count(details.webContentsId, host);
      return callback({ cancel: true });
    }

    // Рекламные пути на домене самого сайта (например, yandex.ru/ads/…).
    if (s.blockAds && isAdUrl(details.url)) {
      this._count(details.webContentsId, host);
      return callback({ cancel: true });
    }

    callback({});
  }

  _hardenHeaders(details) {
    const s = this.getSettings();
    const headers = details.requestHeaders || {};
    const host = (() => { try { return new URL(details.url).hostname.toLowerCase(); } catch { return ''; } })();
    const topUrl = this._topUrl(details);
    const topHost = topUrl ? (() => { try { return new URL(topUrl).hostname.toLowerCase(); } catch { return ''; } })() : '';
    const thirdParty = topHost ? siteOf(topHost) !== siteOf(host) : false;

    const lower = new Map();
    for (const key of Object.keys(headers)) lower.set(key.toLowerCase(), key);

    if (s.sendDnt) {
      headers['DNT'] = '1';
      headers['Sec-GPC'] = '1';
    }

    for (const name of TELEMETRY_HEADERS) {
      const key = lower.get(name);
      if (key) delete headers[key];
    }

    // Client Hints должны совпадать с тем, что видит JS (см. preload-page.js).
    if (lower.has('sec-ch-ua') || details.resourceType === 'mainFrame') {
      headers[lower.get('sec-ch-ua') || 'Sec-CH-UA'] = CH_BRANDS;
      headers[lower.get('sec-ch-ua-mobile') || 'Sec-CH-UA-Mobile'] = '?0';
      headers[lower.get('sec-ch-ua-platform') || 'Sec-CH-UA-Platform'] = '"Windows"';
    }
    if (lower.has('sec-ch-ua-full-version-list')) {
      headers[lower.get('sec-ch-ua-full-version-list')] = CH_FULL_LIST;
    }
    if (lower.has('sec-ch-ua-full-version')) {
      headers[lower.get('sec-ch-ua-full-version')] = `"${CHROME_FULL}"`;
    }

    // Чиним задвоенные q-веса в Accept-Language (ru-RU,ru;q=0.9;q=0.9).
    const langKey = lower.get('accept-language');
    if (langKey && /;q=[\d.]+;q=/.test(String(headers[langKey]))) {
      headers[langKey] = String(headers[langKey]).replace(/(;q=[\d.]+)(?=;q=)/g, '');
    }

    if ((s.blockThirdPartyCookies && thirdParty) || (s.blockTrackers && this.isBlocked(host))) {
      for (const name of ['cookie', 'cookie2']) {
        const key = lower.get(name);
        if (key) delete headers[key];
      }
    }

    if (s.trimReferrer && thirdParty) {
      const key = lower.get('referer');
      if (key && headers[key]) {
        const origin = originOf(headers[key]);
        if (origin) headers[key] = origin;
      }
    }

    return headers;
  }

  _topUrl(details) {
    if (details.webContentsId) {
      const wc = webContents.fromId(details.webContentsId);
      if (wc && !wc.isDestroyed()) {
        const url = wc.getURL();
        if (url && url !== 'about:blank') return url;
      }
    }
    return details.referrer || '';
  }

  _count(wcId, host) {
    if (!wcId) return;
    let c = this._counters.get(wcId);
    if (!c) {
      c = { blocked: 0, hosts: new Map() };
      this._counters.set(wcId, c);
    }
    c.blocked++;
    c.hosts.set(host, (c.hosts.get(host) || 0) + 1);
    this._blockedTotal++;
    this.onBlocked(wcId);
  }

  getBlocked(wcId) {
    const c = this._counters.get(wcId);
    if (!c) return 0;
    return c.blocked;
  }

  getStats(wcId) {
    const c = this._counters.get(wcId);
    return {
      blocked: c ? c.blocked : 0,
      total: this._blockedTotal,
      blocklistSize: this.blocklistSize,
      topHosts: c ? [...c.hosts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([h, n]) => ({ host: h, count: n })) : [],
    };
  }

  resetCounters(wcId) {
    if (wcId === undefined) this._counters.clear();
    else this._counters.delete(wcId);
  }
}

module.exports = { Privacy, siteOf, isLocalHost };
