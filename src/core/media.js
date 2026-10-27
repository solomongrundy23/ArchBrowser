'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { net } = require('electron');

// Загрузка видео и музыки.
//
// • Прямые ссылки (mp4, mp3, m4a, webm, ogg, flac, mkv…) качаются сразу
//   с учётом cookies и прокси сессии.
// • HLS-потоки (m3u8) собираются в файл сегмент за сегментом.
// • Для сайтов-видеосервисов (YouTube, Rutube, VK Видео и другие) используется
//   yt-dlp, который входит в поставку.

const DIRECT_EXT = /\.(mp4|m4v|webm|mkv|mov|avi|flv|mp3|m4a|aac|ogg|oga|opus|wav|flac)(?:$|\?)/i;
const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)(?:$|\?)/i;
const VIDEO_EXT = /\.(mp4|m4v|webm|mkv|mov|avi|flv)(?:$|\?)/i;

const VIDEO_HOSTS = [
  'youtube.com', 'youtu.be', 'rutube.ru', 'rutube.com', 'vk.com', 'vkvideo.ru',
  'vimeo.com', 'dailymotion.com', 'ok.ru', 'my.mail.ru', 'tiktok.com',
  'twitch.tv', 'livejournal.com', 'smotrim.ru', 'russia.tv', '1tv.ru', 'ntv.ru',
];
const MUSIC_HOSTS = [
  'music.yandex.ru', 'music.yandex.com', 'vk.com', 'vk.ru', 'music.mail.ru',
  'zvuk.com', 'deezer.com', 'spotify.com', 'soundcloud.com', 'youtube.com',
  'music.youtube.com', 'kion.ru', 'mts.ru',
];

function isVideoHost(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return VIDEO_HOSTS.some((h) => host === h || host.endsWith('.' + h));
  } catch {
    return false;
  }
}

function isMusicHost(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return MUSIC_HOSTS.some((h) => host === h || host.endsWith('.' + h));
  } catch {
    return false;
  }
}

function safeName(name, fallback = 'media') {
  const clean = String(name || '')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return clean || fallback;
}

class MediaManager {
  constructor({ resourcesDir, getSettings, session, getProxy, userAgent, onChange }) {
    this.resourcesDir = resourcesDir;
    this.getSettings = getSettings;
    this.session = session;
    // Прокси для yt-dlp: отдельный процесс не знает о VPN браузера.
    this.getProxy = getProxy || (() => '');
    this.userAgent = userAgent || '';
    this.onChange = onChange || (() => {});
    this.found = new Map(); // url -> { url, kind, title, tabId, size }
    this.jobs = [];
    this.ytDlpPath = path.join(resourcesDir, 'media', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  }

  available() {
    return fs.existsSync(this.ytDlpPath);
  }

  // Обнаружение идёт из preload страницы: там видно и <video>/<audio>, и
  // сетевые запросы媒体. Штатный webRequest здесь не используется — он
  // перехватывается модулем приватности.
  add(url, { kind = '', title = '', tabId = 0 } = {}) {
    if (!url || !/^https?:/i.test(url)) return false;
    if (this.getSettings && !this.getSettings('mediaAutoDetect')) return false;
    const key = url.split('#')[0];
    if (this.found.has(key)) return false;
    const type = /\.m3u8(\?|$)/i.test(key)
      ? 'hls'
      : AUDIO_EXT.test(key)
        ? 'audio'
        : VIDEO_EXT.test(key)
          ? 'video'
          : (kind || 'media');
    this.found.set(key, {
      url: key,
      kind: type,
      title: title || '',
      tabId,
      size: 0,
      at: Date.now(),
    });
    if (this.found.size > 300) {
      const oldest = [...this.found.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 100);
      for (const [k] of oldest) this.found.delete(k);
    }
    this.onChange();
    return true;
  }

  list() {
    const items = [...this.found.values()].sort((a, b) => b.at - a.at);
    return items.map((item) => ({
      ...item,
      host: (() => {
        try {
          return new URL(item.url).hostname;
        } catch {
          return '';
        }
      })(),
    }));
  }

  jobsList() {
    return this.jobs;
  }

  clear() {
    this.found.clear();
    this.onChange();
  }

  _targetDir() {
    const configured = this.getSettings ? this.getSettings('downloadDir') : '';
    const dir = configured || path.join(os.homedir(), 'Downloads');
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {}
    return dir;
  }

  _uniquePath(dir, name, ext) {
    let target = path.join(dir, `${safeName(name)}${ext}`);
    let n = 1;
    while (fs.existsSync(target)) {
      target = path.join(dir, `${safeName(name)} (${n})${ext}`);
      n++;
    }
    return target;
  }

  // ---------- загрузка ----------

  async download(url, { title = '', kind = '', referer = '' } = {}) {
    const job = {
      id: `media-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
      url,
      title: title || url,
      state: 'progressing',
      received: 0,
      total: 0,
      startedAt: Date.now(),
      kind,
      referer,
    };
    this.jobs.unshift(job);
    this.onChange();
    try {
      if (/\.m3u8(\?|$)/i.test(url)) await this._downloadHls(job);
      else if (DIRECT_EXT.test(url)) await this._downloadDirect(job);
      else await this._downloadWithYtDlp(job, { audio: AUDIO_EXT.test(url) });
    } catch (err) {
      job.state = 'interrupted';
      job.error = err.message;
      this.onChange();
    }
    return job;
  }

  _finish(job, filePath) {
    job.state = 'completed';
    job.filePath = filePath;
    job.fileName = path.basename(filePath);
    this.onChange();
  }

  async _downloadDirect(job) {
    const dir = this._targetDir();
    const ext = (job.url.match(DIRECT_EXT) || ['', '.bin'])[0].split('?')[0];
    const target = this._uniquePath(dir, job.title || 'media', ext || '.bin');
    const res = await this._request(job.url, job);
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(target);
      res.on('data', (chunk) => {
        job.received += chunk.length;
        this.onChange();
      });
      res.on('end', () => {
        out.end(() => resolve());
      });
      res.on('error', (err) => {
        out.destroy();
        reject(err);
      });
      res.pipe(out);
    });
    this._finish(job, target);
  }

  _request(url, job, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
      const headers = {
        'User-Agent': this.userAgent,
        ...extraHeaders,
      };
      // Ссылка на страницу: без неё многие CDN отдают 403.
      if (job && job.referer) headers.Referer = job.referer;
      const req = net.request({
        method: 'GET',
        url,
        session: this.session,
        headers,
      });
      req.on('response', (res) => {
        if (res.statusCode >= 400) {
          reject(new Error(`Сервер ответил ${res.statusCode}`));
          return;
        }
        job.total = Number(res.headers['content-length']) || 0;
        resolve(res);
      });
      req.on('error', (err) => reject(new Error(err.message)));
      req.end();
    });
  }

  // HLS: собираем сегменты плейлиста в один файл.
  async _downloadHls(job) {
    const dir = this._targetDir();
    const target = this._uniquePath(dir, job.title || 'video', '.ts');
    const base = new URL(job.url);
    const playlistText = await this._text(job.url);
    const lines = playlistText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.some((l) => l.startsWith('#EXTM3U'))) {
      throw new Error('Плейлист HLS не распознан');
    }
    const segments = [];
    let init = null;
    for (const line of lines) {
      if (line.startsWith('#EXT-X-MAP:')) {
        const m = line.match(/URI="([^"]+)"/);
        if (m) init = new URL(m[1], base).href;
        continue;
      }
      if (line.startsWith('#')) continue;
      segments.push(new URL(line, base).href);
    }
    if (!segments.length) throw new Error('В плейлисте нет сегментов');
    const out = fs.createWriteStream(target);
    const write = (buffer) => new Promise((resolve, reject) => {
      out.write(buffer, (err) => (err ? reject(err) : resolve()));
    });
    if (init) {
      const res = await this._request(init, job);
      await new Promise((resolve, reject) => {
        res.on('data', (c) => write(c));
        res.on('end', resolve);
        res.on('error', reject);
      });
    }
    for (const segment of segments) {
      const res = await this._request(segment, job);
      await new Promise((resolve, reject) => {
        res.on('data', (c) => {
          job.received += c.length;
          this.onChange();
          write(c);
        });
        res.on('end', resolve);
        res.on('error', reject);
      });
    }
    await new Promise((resolve) => out.end(resolve));
    this._finish(job, target);
  }

  async _text(url) {
    const res = await this._request(url, { received: 0, total: 0 });
    return new Promise((resolve, reject) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });
  }

  // yt-dlp: сайт целиком (YouTube, Rutube, VK Видео и другие).
  async _downloadWithYtDlp(job, { audio = false } = {}) {
    if (!this.available()) {
      throw new Error('Загрузчик yt-dlp не найден в поставке');
    }
    const dir = this._targetDir();
    const args = [
      '--no-playlist',
      '--no-warnings',
      '--newline',
      '--no-color',
      '--progress',
      '--retries', '3',
      '--socket-timeout', '30',
      '-f', audio ? 'bestaudio/best' : 'bestvideo+bestaudio/best',
      '--merge-output-format', 'mp4',
      '-o', path.join(dir, `${safeName(job.title || 'media')}.%(ext)s`),
    ];
    // Через VPN: youtube и rutube без прокси недоступны.
    const proxy = this.getProxy ? this.getProxy() : '';
    if (proxy) args.push('--proxy', proxy);
    if (audio) args.push('-x', '--audio-format', 'mp3');
    args.push(job.url);

    await new Promise((resolve, reject) => {
      const proc = spawn(this.ytDlpPath, args, { windowsHide: true });
      let stderr = '';
      proc.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        for (const line of text.split(/\r?\n/)) {
          const m = line.match(/\[download\]\s+([\d.]+)%(?:\s+of\s+~?\s*([\d.]+)\s*(K|M|G)iB)?/i);
          if (m) {
            job.received = Math.round((Number(m[1]) / 100) * (job.total || 0));
            this.onChange();
          }
          const dest = line.match(/\[Merger\] Merging formats into "(.+?)"/) || line.match(/\[download\] Destination: (.+)$/);
          if (dest) job.filePath = dest[1];
        }
      });
      proc.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      proc.on('error', (err) => reject(new Error(err.message)));
      proc.on('close', (code) => {
        if (code === 0) {
          if (job.filePath) {
            job.total = job.total || 0;
            this._finish(job, job.filePath);
            resolve();
          } else {
            reject(new Error('yt-dlp не создал файл'));
          }
        } else {
          const message = stderr.split(/\r?\n/).filter(Boolean).slice(-3).join(' · ');
          reject(new Error(message || `yt-dlp завершился с кодом ${code}`));
        }
      });
    });
  }
}

module.exports = { MediaManager, isVideoHost, isMusicHost, safeName };
