'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { net } = require('electron');
const { JsonStore } = require('./store');

// Подписки RSS/Atom.
//
// Ленты хранятся в feeds.json, загруженные заголовки — в памяти и в
// items.json (кэш, чтобы лента была видна сразу после запуска).

const MAX_ITEMS_PER_FEED = 40;
const DEFAULT_INTERVAL = 30 * 60 * 1000; // 30 минут

function decodeEntities(text) {
  return String(text || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function stripTags(text) {
  return decodeEntities(String(text || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function pick(xml, ...tags) {
  for (const tag of tags) {
    const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
    if (match) return match[1];
    const selfClosing = xml.match(new RegExp(`<${tag}(\\s[^>]*)?/>`, 'i'));
    if (selfClosing) return '';
  }
  return '';
}

function attr(xml, tag, name) {
  const match = xml.match(new RegExp(`<${tag}[^>]*\\s${name}=["']([^"']+)["']`, 'i'));
  return match ? decodeEntities(match[1]) : '';
}

// Разбор RSS 2.0, Atom и RDF/RSS 1.0.
function parseFeed(xml, sourceUrl) {
  const items = [];
  const blocks = [
    ...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi),
    ...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi),
  ];
  for (const block of blocks) {
    const chunk = block[1];
    let link = pick(chunk, 'link');
    if (!link) {
      const atom = chunk.match(/<link[^>]*\shref=["']([^"']+)["']/i);
      link = atom ? atom[1] : '';
    }
    const title = stripTags(pick(chunk, 'title'));
    let description = stripTags(pick(chunk, 'description', 'summary', 'content'));
    if (description.length > 400) description = `${description.slice(0, 397)}…`;
    let date = pick(chunk, 'pubDate', 'published', 'updated', 'date');
    if (date) date = decodeEntities(date);
    const time = date ? Date.parse(date) : NaN;
    items.push({
      id: crypto.createHash('sha1').update(`${sourceUrl}|${link}|${title}`).digest('hex').slice(0, 12),
      title: title || '(без названия)',
      link: (link || '').trim(),
      description,
      date: Number.isFinite(time) ? time : 0,
      feed: sourceUrl,
    });
  }
  const feedTitle = stripTags(pick(xml, 'channel > title', 'title'));
  items.sort((a, b) => b.date - a.date);
  return { title: feedTitle || sourceUrl, items: items.slice(0, MAX_ITEMS_PER_FEED) };
}

class RssService {
  constructor({ userDataDir, getSettings, session, onChange }) {
    this.store = new JsonStore(path.join(userDataDir, 'feeds.json'), { feeds: [] });
    this.cache = new JsonStore(path.join(userDataDir, 'rss-items.json'), { items: [] });
    this.getSettings = getSettings || (() => ({}));
    this.session = session;
    this.onChange = onChange || (() => {});
    this.timer = null;
    this.loading = false;
  }

  feeds() {
    return this.store.get('feeds') || [];
  }

  items() {
    return this.cache.get('items') || [];
  }

  isEnabled() {
    return !!this.getSettings('rssEnabled');
  }

  // Добавление ленты: проверяем, что она действительно читается.
  async add(url, title = '') {
    const clean = String(url || '').trim();
    if (!/^https?:\/\//i.test(clean)) throw new Error('Укажите адрес ленты (http:// или https://)');
    const parsed = await this.fetchFeed(clean);
    const feeds = [...this.feeds()];
    if (feeds.some((f) => f.url === clean)) throw new Error('Эта лента уже добавлена');
    const feed = {
      id: crypto.createHash('sha1').update(clean).digest('hex').slice(0, 12),
      url: clean,
      title: title || parsed.title || clean,
      addedAt: Date.now(),
      lastFetch: Date.now(),
      error: '',
    };
    feeds.push(feed);
    this.store.set({ feeds });
    this._mergeItems(parsed.items);
    this.onChange();
    return feed;
  }

  remove(id) {
    const feeds = this.feeds().filter((f) => f.id !== id);
    this.store.set({ feeds });
    const items = this.items().filter((item) => {
      const feed = this.feeds().find((f) => f.id === id);
      return !feed || item.feed !== feed.url;
    });
    this.cache.set({ items });
    this.onChange();
    return true;
  }

  rename(id, title) {
    const clean = String(title || '').trim();
    if (!clean) throw new Error('Укажите название ленты');
    const feeds = this.feeds().map((f) => (f.id === id ? { ...f, title: clean } : f));
    this.store.set({ feeds });
    this.onChange();
    return true;
  }

  _mergeItems(newItems) {
    const seen = new Set();
    const merged = [];
    for (const item of [...newItems, ...this.items()]) {
      if (!item || !item.link || seen.has(item.id)) continue;
      seen.add(item.id);
      merged.push(item);
    }
    merged.sort((a, b) => b.date - a.date);
    const limited = merged.slice(0, 400);
    this.cache.set({ items: limited });
    return limited;
  }

  async fetchFeed(url) {
    const res = await this._request(url);
    const xml = await this._text(res);
    return parseFeed(xml, url);
  }

  _request(url) {
    return new Promise((resolve, reject) => {
      const req = net.request({
        method: 'GET',
        url,
        session: this.session,
        headers: {
          'User-Agent': 'ArchBrowser/0.1 (RSS reader)',
          Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
        },
      });
      req.on('response', (res) => {
        if (res.statusCode >= 400) {
          reject(new Error(`Лента вернула ${res.statusCode}`));
          return;
        }
        resolve(res);
      });
      req.on('error', (err) => reject(new Error(err.message)));
      req.end();
    });
  }

  _text(res) {
    return new Promise((resolve, reject) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });
  }

  async refresh() {
    if (this.loading || !this.isEnabled()) return;
    const feeds = this.feeds();
    if (!feeds.length) return;
    this.loading = true;
    try {
      for (const feed of feeds) {
        try {
          const parsed = await this.fetchFeed(feed.url);
          this._mergeItems(parsed.items);
          this.store.set({
            feeds: this.feeds().map((f) => (f.id === feed.id
              ? { ...f, title: f.title || parsed.title, lastFetch: Date.now(), error: '' }
              : f)),
          });
        } catch (err) {
          this.store.set({
            feeds: this.feeds().map((f) => (f.id === feed.id
              ? { ...f, lastFetch: Date.now(), error: err.message }
              : f)),
          });
        }
      }
    } finally {
      this.loading = false;
      this.onChange();
    }
  }

  start() {
    this.stop();
    const minutes = Number(this.getSettings('rssIntervalMinutes')) || 30;
    this.timer = setInterval(() => this.refresh().catch(() => {}), Math.max(5, minutes) * 60 * 1000);
    if (this.timer.unref) this.timer.unref();
    setTimeout(() => this.refresh().catch(() => {}), 3000);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

module.exports = { RssService, parseFeed, stripTags, decodeEntities };
