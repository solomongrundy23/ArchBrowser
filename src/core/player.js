'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { dialog } = require('electron');

// Плейлист локального плеера.
//
// Файлы добавляются по одному или целыми папками. Папки могут содержать
// десятки тысяч композиций, поэтому обход дерева идёт асинхронно и регулярно
// уступает событийный цикл: интерфейс не замирает во время сканирования.
// Список хранится компактным JSON и сохраняется фоновой записью.

const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|wma|aiff|webm)$/i;
const PAGE_MAX = 500;

const pathKey = (file) => (process.platform === 'win32' ? String(file).toLowerCase() : String(file));
const tick = () => new Promise((resolve) => setImmediate(resolve));

function trackFromFile(file, folder = '') {
  let size = 0;
  try {
    size = fs.statSync(file).size;
  } catch {}
  return {
    id: crypto.createHash('sha1').update(pathKey(file)).digest('hex').slice(0, 12),
    path: file,
    name: path.basename(file),
    folder,
    size,
    addedAt: Date.now(),
  };
}

class PlayerService {
  constructor({ userDataDir, getSettings, onChange }) {
    this.file = path.join(userDataDir, 'playlist.json');
    this.getSettings = getSettings || (() => ({}));
    this.onChange = onChange || (() => {});
    this.pageState = { active: false, title: '', artist: '', playing: false, duration: 0, position: 0 };
    // historyIndex — курсор в истории прослушиваний. Благодаря ему кнопка
    // «Назад» действительно возвращает предыдущую композицию, а не прыгает
    // вперёд по последним записям (раньше каждая проигранная с истории
    // композиция снова дописывалась в конец).
    this.data = { tracks: [], history: [], historyIndex: -1 };
    this._saveTimer = null;
    this._saving = null;
    this._dirty = false;
    this._load();
    // Удалённые с диска файлы убираем из плейлиста молча.
    this._pruneMissing().catch(() => {});
  }

  _load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const tracks = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.tracks) ? parsed.tracks : [];
      const history = !Array.isArray(parsed) && parsed && Array.isArray(parsed.history) ? parsed.history : [];
      const ids = new Set(tracks.filter((t) => t && t.path && t.id).map((t) => t.id));
      const cleanHistory = history.filter((id) => ids.has(id)).slice(-1000);
      let historyIndex = -1;
      if (!Array.isArray(parsed) && parsed && Number.isInteger(parsed.historyIndex)) {
        historyIndex = parsed.historyIndex;
      }
      if (historyIndex < 0 || historyIndex >= cleanHistory.length) historyIndex = cleanHistory.length - 1;
      this.data = {
        tracks: tracks.filter((t) => t && t.path && t.id),
        // Последние 1000 прослушиваний переживают перезапуск приложения.
        history: cleanHistory,
        historyIndex,
      };
    } catch {
      this.data = { tracks: [], history: [], historyIndex: -1 };
    }
  }

  async _pruneMissing() {
    const tracks = this.tracks();
    if (!tracks.length) return;
    const missing = [];
    for (let i = 0; i < tracks.length; i += 64) {
      await Promise.all(tracks.slice(i, i + 64).map(async (track) => {
        try {
          await fs.promises.access(track.path, fs.constants.F_OK);
        } catch {
          missing.push(track.id);
        }
      }));
    }
    if (!missing.length) return;
    const gone = new Set(missing);
    this.data.tracks = tracks.filter((track) => !gone.has(track.id));
    const currentId = this.history()[this.historyIndex];
    this.data.history = this.history().filter((id) => !gone.has(id));
    const nextIndex = currentId ? this.data.history.lastIndexOf(currentId) : -1;
    this.data.historyIndex = nextIndex >= 0 ? nextIndex : Math.min(this.historyIndex, this.data.history.length - 1);
    this.saveSoon();
    this.onChange();
  }

  _saveNow() {
    if (this._saving) {
      this._dirty = true;
      return;
    }
    const tmp = `${this.file}.tmp`;
    const text = JSON.stringify(this.data);
    this._saving = fs.promises.mkdir(path.dirname(this.file), { recursive: true })
      .then(() => fs.promises.writeFile(tmp, text, 'utf8'))
      .then(() => fs.promises.rename(tmp, this.file))
      .catch((err) => console.error('[player] cannot save playlist:', err.message))
      .finally(() => {
        this._saving = null;
        if (this._dirty) {
          this._dirty = false;
          this._saveNow();
        }
      });
  }

  saveSoon() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._saveNow();
    }, 250);
  }

  flush() {
    clearTimeout(this._saveTimer);
    this._saveTimer = null;
    this._saveNow();
  }

  enabled() {
    const settings = this.getSettings() || {};
    return settings.featureLocalPlayer !== false;
  }

  controllerEnabled() {
    const settings = this.getSettings() || {};
    return settings.featureMediaController !== false;
  }

  tracks() {
    return this.data.tracks;
  }

  history() {
    if (!Array.isArray(this.data.history)) this.data.history = [];
    return this.data.history;
  }

  // Запоминаем факт проигрывания. Хранится до 1000 последних композиций.
  // Если пользователь вернулся назад, «будущее» истории отрезается — как в
  // обычном списке «Назад/Вперёд».
  remember(id) {
    if (!id || !this.track(id)) return false;
    const history = this.history();
    if (!Number.isInteger(this.data.historyIndex)) this.data.historyIndex = history.length - 1;
    if (history[this.data.historyIndex] === id) return false;
    if (this.data.historyIndex < history.length - 1) {
      history.splice(this.data.historyIndex + 1);
    }
    // Не дописываем подряд идущий дубль.
    if (history[history.length - 1] === id) {
      this.data.historyIndex = history.length - 1;
      this.saveSoon();
      return false;
    }
    history.push(id);
    if (history.length > 1000) history.splice(0, history.length - 1000);
    this.data.historyIndex = history.length - 1;
    this.saveSoon();
    return true;
  }

  // Первая композиция (или случайная при перемешивании) — для кнопки Play,
  // когда ничего не выбрано.
  start({ shuffle = false } = {}) {
    const all = this.tracks();
    if (!all.length) return null;
    if (!shuffle) return all[0];
    return all[Math.floor(Math.random() * all.length)];
  }

  // Предыдущая композиция из истории прослушиваний. Именно история, а не
  // порядок плейлиста: кнопка «Назад» возвращает то, что играло до этого.
  // Курсор истории сдвигается назад, поэтому повторные нажатия идут дальше
  // вглубь, а не возвращают только что проигранный трек.
  previous(id, { fallback = false } = {}) {
    const history = this.history();
    if (!history.length) return null;
    if (!Number.isInteger(this.data.historyIndex)) this.data.historyIndex = history.length - 1;
    let index = this.data.historyIndex;
    // После перезапуска «Назад» без текущего трека открывает последнюю
    // композицию из истории.
    if (!id) {
      const lastIndex = Math.max(0, Math.min(this.data.historyIndex, history.length - 1));
      const last = this.track(history[lastIndex]);
      if (last) {
        this.data.historyIndex = lastIndex;
        this.saveSoon();
        return last;
      }
      return null;
    }
    if (history[index] !== id) {
      const found = history.lastIndexOf(id);
      if (found >= 0) index = found;
    }
    for (let i = index - 1; i >= 0; i--) {
      if (history[i] === id) continue;
      const track = this.track(history[i]);
      if (!track) continue;
      this.data.historyIndex = i;
      this.saveSoon();
      return track;
    }
    if (!fallback) return null;
    // Если назад идти уже некуда, отдаём предыдущую запись истории, но не
    // текущую композицию.
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i] === id) continue;
      const track = this.track(history[i]);
      if (track) {
        this.data.historyIndex = i;
        this.saveSoon();
        return track;
      }
    }
    return null;
  }

  summary() {
    const tracks = this.tracks();
    let size = 0;
    for (const track of tracks) size += Number(track.size) || 0;
    return { total: tracks.length, size };
  }

  page(query = '', offset = 0, limit = 200) {
    const text = String(query || '').trim().toLowerCase();
    const all = this.tracks();
    const filtered = text
      ? all.filter((track) => `${track.name || ''} ${track.path || ''} ${track.folder || ''}`.toLowerCase().includes(text))
      : all;
    const start = Math.max(0, Number(offset) || 0);
    const count = Math.min(PAGE_MAX, Math.max(1, Number(limit) || 200));
    return {
      tracks: filtered.slice(start, start + count),
      total: filtered.length,
      allTotal: all.length,
      offset: start,
      limit: count,
    };
  }

  track(id) {
    return this.tracks().find((track) => track.id === id) || null;
  }

  next(id, { shuffle = false, direction = 1, wrap = false } = {}) {
    const all = this.tracks();
    if (!all.length) return null;
    const dir = Number(direction) < 0 ? -1 : 1;
    let index = all.findIndex((track) => track.id === id);
    if (index < 0) index = dir > 0 ? -1 : 0;
    if (shuffle && all.length > 1) {
      let pick = index;
      for (let attempt = 0; attempt < 20 && pick === index; attempt++) {
        pick = Math.floor(Math.random() * all.length);
      }
      if (pick === index) pick = (index + 1) % all.length;
      return all[pick];
    }
    let nextIndex = index + dir;
    if (nextIndex < 0 || nextIndex >= all.length) {
      if (!wrap) return null;
      nextIndex = (nextIndex + all.length) % all.length;
    }
    return all[nextIndex];
  }

  async addFromDialog(win) {
    const options = {
      title: 'Выберите музыку',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Аудио', extensions: ['mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'flac', 'wma', 'aiff'] },
        { name: 'Все файлы', extensions: ['*'] },
      ],
    };
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (res.canceled || !res.filePaths.length) return { canceled: true, added: [], total: this.tracks().length };
    return this.addFiles(res.filePaths);
  }

  async addFiles(paths) {
    const existing = this.tracks();
    const seen = new Set(existing.map((track) => pathKey(track.path)));
    const added = [];
    for (const file of paths) {
      if (!AUDIO_EXT.test(file)) continue;
      const key = pathKey(file);
      if (seen.has(key)) continue;
      seen.add(key);
      const track = trackFromFile(file, path.basename(path.dirname(file)));
      existing.push(track);
      added.push(track);
    }
    if (added.length) {
      this.saveSoon();
      this.onChange();
    }
    return { canceled: false, added, addedCount: added.length, total: existing.length };
  }

  async addFoldersFromDialog(win, onProgress) {
    const options = {
      title: 'Выберите папки с музыкой',
      properties: ['openDirectory', 'multiSelections'],
    };
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (res.canceled || !res.filePaths.length) return { canceled: true, added: [], addedCount: 0, total: this.tracks().length };
    return this.addFolders(res.filePaths, onProgress);
  }

  async addFolders(roots, onProgress) {
    const report = typeof onProgress === 'function' ? onProgress : () => {};
    const existing = this.tracks();
    const seen = new Set(existing.map((track) => pathKey(track.path)));
    const added = [];
    const stack = roots.filter(Boolean).map((root) => path.resolve(root));
    let scanned = 0;
    let dirs = 0;

    while (stack.length) {
      const dir = stack.pop();
      dirs++;
      let entries = [];
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        // Символические ссылки пропускаем: они могут образовать цикл.
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (AUDIO_EXT.test(entry.name)) {
          const key = pathKey(full);
          if (!seen.has(key)) {
            seen.add(key);
            const track = {
              id: crypto.createHash('sha1').update(key).digest('hex').slice(0, 12),
              path: full,
              name: entry.name,
              folder: path.basename(dir),
              size: 0,
              addedAt: Date.now(),
            };
            added.push(track);
            existing.push(track);
          }
        }
        scanned++;
        if (scanned % 300 === 0) {
          report({ phase: 'scan', scanned, dirs, added: added.length });
          await tick();
        }
      }
      if (dirs % 20 === 0) {
        report({ phase: 'scan', scanned, dirs, added: added.length });
        await tick();
      }
    }

    // Размер нужен для итоговой строки, но stat для каждого файла не должен
    // блокировать интерфейс — обрабатываем небольшими пачками.
    let sized = 0;
    for (let i = 0; i < added.length; i += 64) {
      await Promise.all(added.slice(i, i + 64).map(async (track) => {
        try {
          track.size = (await fs.promises.stat(track.path)).size;
        } catch {}
      }));
      sized += Math.min(64, added.length - i);
      report({ phase: 'size', scanned, sized, added: added.length });
      await tick();
    }

    if (added.length) {
      this.saveSoon();
      this.onChange();
    }
    report({ phase: 'done', scanned, dirs, added: added.length });
    return { canceled: false, added, addedCount: added.length, scanned, dirs, total: existing.length };
  }

  remove(id) {
    this.data.tracks = this.tracks().filter((track) => track.id !== id);
    this.data.history = this.history().filter((item) => item !== id);
    this.data.historyIndex = Math.min(this.data.historyIndex, this.data.history.length - 1);
    this.saveSoon();
    this.onChange();
    return true;
  }

  clear() {
    this.data.tracks = [];
    this.data.history = [];
    this.data.historyIndex = -1;
    this.saveSoon();
    this.onChange();
    return true;
  }

  // Состояние воспроизведения на странице (приходит из preload).
  setPageState(state) {
    const next = {
      active: !!(state && state.active),
      title: (state && state.title) || '',
      artist: (state && state.artist) || '',
      playing: !!(state && state.playing),
      duration: Number(state && state.duration) || 0,
      position: Number(state && state.position) || 0,
    };
    const changed = JSON.stringify(next) !== JSON.stringify(this.pageState);
    this.pageState = next;
    if (changed) this.onChange();
    return next;
  }

  // Управление медиа на странице: play, pause, next, prev, stop.
  async pageControl(action, wc) {
    if (!wc || wc.isDestroyed()) throw new Error('Нет активной страницы');
    const script = {
      play: "navigator.mediaSession && navigator.mediaSession.play ? navigator.mediaSession.play() : null",
      pause: "navigator.mediaSession && navigator.mediaSession.pause ? navigator.mediaSession.pause() : null",
      next: "navigator.mediaSession && navigator.mediaSession.nextTrack ? navigator.mediaSession.nextTrack() : null",
      prev: "navigator.mediaSession && navigator.mediaSession.previousTrack ? navigator.mediaSession.previousTrack() : null",
      stop: "(() => { for (const el of document.querySelectorAll('video,audio')) { try { el.pause(); } catch (e) {} } return true; })()",
    }[action];
    if (!script) throw new Error('Неизвестное действие');
    await wc.executeJavaScript(`(() => { try { ${script}; return true; } catch (e) { return false; } })()`);
    return true;
  }
}

module.exports = { PlayerService, AUDIO_EXT };
