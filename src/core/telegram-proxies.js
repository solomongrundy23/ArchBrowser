'use strict';

const path = require('path');
const { net, shell, app } = require('electron');
const { JsonStore } = require('./store');

const RELEASE_API = 'https://api.github.com/repos/kort0881/telegram-proxy-collector/releases/latest';
const ASSET_NAME = 'proxy_all_verified.json';

// Telegram Web A не умеет хранить MTProto-прокси: такие прокси — часть
// протокола Telegram, а не HTTP/SOCKS для браузера. Поэтому импорт передаёт
// проверенные ссылки tg://proxy установленному Telegram Desktop, а уже
// отправленные ссылки запоминаются, чтобы не дублировать их при следующем
// запуске.
class TelegramProxyService {
  constructor({ userDataDir }) {
    this.store = new JsonStore(path.join(userDataDir, 'telegram-proxies.json'), {
      sent: [],
      lastRelease: '',
      lastFetchedAt: 0,
    });
  }

  sent() {
    return this.store.get('sent') || [];
  }

  history() {
    return {
      sent: this.sent().length,
      lastRelease: this.store.get('lastRelease') || '',
      lastFetchedAt: this.store.get('lastFetchedAt') || 0,
    };
  }

  async fetchLatest() {
    const headers = {
      'User-Agent': 'ArchBrowser/1.0 (Telegram proxy importer)',
      Accept: 'application/vnd.github+json',
    };
    const releaseRes = await net.fetch(RELEASE_API, { headers });
    if (!releaseRes.ok) throw new Error(`GitHub API ответил ${releaseRes.status}`);
    const release = await releaseRes.json();
    const asset = (release.assets || []).find((item) => item.name === ASSET_NAME);
    if (!asset) throw new Error(`В последнем релизе нет ${ASSET_NAME}`);
    const fileRes = await net.fetch(asset.browser_download_url, { headers: { 'User-Agent': headers['User-Agent'] } });
    if (!fileRes.ok) throw new Error(`Не удалось скачать ${ASSET_NAME}: ${fileRes.status}`);
    const raw = await fileRes.json();
    if (!Array.isArray(raw)) throw new Error('Некорректный формат списка прокси');
    const seen = new Set();
    const proxies = [];
    for (const item of raw) {
      if (!item || item.type !== 'mtproto') continue;
      const host = String(item.host || '').trim();
      const port = Number(item.port);
      const secret = String(item.secret || '').trim();
      if (!host || !port || !secret) continue;
      const link = `tg://proxy?server=${encodeURIComponent(host)}&port=${port}&secret=${encodeURIComponent(secret)}`;
      if (seen.has(link)) continue;
      seen.add(link);
      proxies.push({
        host,
        port,
        secret,
        link,
        region: item.region || '',
        quality: Number(item.quality_score) || 0,
      });
    }
    if (!proxies.length) throw new Error('В файле не найдено MTProto-прокси');
    proxies.sort((a, b) => b.quality - a.quality);
    this.store.set({
      lastRelease: release.tag_name || '',
      lastFetchedAt: Date.now(),
    });
    return { proxies, tag: release.tag_name || '', asset: asset.browser_download_url };
  }

  missing(proxies) {
    const known = new Set(this.sent());
    return proxies.filter((proxy) => !known.has(proxy.link));
  }

  async importAll({ limit = 200 } = {}) {
    if (process.platform === 'win32') {
      let handler = '';
      try {
        handler = app.getApplicationNameForProtocol('tg:');
      } catch {}
      if (!handler) {
        throw new Error('Telegram Desktop не найден. Установите Telegram, чтобы добавлять MTProto-прокси.');
      }
    }
    const { proxies, tag } = await this.fetchLatest();
    const fresh = this.missing(proxies).slice(0, Math.max(1, Number(limit) || 200));
    let opened = 0;
    const errors = [];
    for (const proxy of fresh) {
      try {
        await shell.openExternal(proxy.link);
        opened++;
        const sent = new Set(this.sent());
        sent.add(proxy.link);
        this.store.set({ sent: [...sent].slice(-2000) });
        // Даём Telegram время показать диалог добавления прокси.
        await new Promise((resolve) => setTimeout(resolve, 700));
      } catch (err) {
        errors.push(`${proxy.host}: ${err.message}`);
        break;
      }
    }
    return {
      total: proxies.length,
      fresh: fresh.length,
      opened,
      skipped: proxies.length - fresh.length,
      tag,
      errors,
      history: this.history(),
    };
  }

  async copyAll() {
    const { proxies } = await this.fetchLatest();
    return proxies.map((proxy) => proxy.link).join('\n');
  }

  clearHistory() {
    this.store.set({ sent: [] });
  }
}

module.exports = { TelegramProxyService, RELEASE_API, ASSET_NAME };
