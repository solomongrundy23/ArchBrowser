'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

// BitTorrent-клиент.
//
// Движок torrent-stream отвечает за DHT, трекеры, обмен метаданными magnet
// (BEP 9), peer wire protocol и проверку частей. Этот модуль добавляет
// управление очередью, настройки и данные для интерфейса в духе Transmission.

const DEFAULT_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://explodie.org:6969/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://tracker.moeking.me:6969/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.dler.org:6969/announce',
  // HTTPS-трекеры: работают там, где UDP-трафик трекеров блокируется.
  'https://tracker.tamersunion.org:443/announce',
  'https://tracker.gbitt.info:443/announce',
  'https://opentracker.i2p.rocks:443/announce',
  'https://tracker.nanoha.org:443/announce',
];

// У torrent-stream первый announce в DHT выполняется сразу после создания
// движка — когда таблица DHT ещё пуста. Из-за этого lookup завершается, не
// обойдя ни одного узла, а следующий announce будет только через 15 минут.
// Поэтому DHT ведём отдельным клиентом: дожидаемся bootstrap и только потом
// ищем пиров. Это критично для торрентов, чьи трекеры заблокированы.
const DHT_BOOTSTRAP = [
  { host: 'dht.libtorrent.org', port: 25401 },
  { host: 'dht.transmissionbt.com', port: 6881 },
  { host: 'router.bittorrent.com', port: 6881 },
  { host: 'router.utorrent.com', port: 6881 },
  { host: 'dht.aelitis.com', port: 6881 },
  { host: 'router.bittorrent.cloud', port: 6881 },
  { host: 'dht.bitcomet.com', port: 6881 },
];

let engineFactory = null;
function loadEngine() {
  if (!engineFactory) {
    // Ленивая загрузка: движок тянет DHT и сетевые модули, не мешая старту UI.
    engineFactory = require('torrent-stream');
  }
  return engineFactory;
}

function parseTorrentLink(link) {
  try {
    return require('parse-torrent')(link);
  } catch {
    return null;
  }
}

function flattenTrackers(parsed, extra = []) {
  const list = [];
  if (parsed) {
    if (typeof parsed.announce === 'string') list.push(parsed.announce);
    else if (Array.isArray(parsed.announce)) list.push(...parsed.announce);
    if (Array.isArray(parsed.announceList)) {
      for (const group of parsed.announceList) {
        if (Array.isArray(group)) list.push(...group);
      }
    }
  }
  for (const tracker of extra) if (tracker) list.push(tracker);
  const seen = new Set();
  return list.filter((tracker) => {
    const text = String(tracker || '').trim();
    if (!/^(https?|udp):\/\//i.test(text) || seen.has(text)) return false;
    seen.add(text);
    return true;
  });
}

const pluralBytes = (bytes) => {
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  let n = Math.max(0, Number(bytes) || 0);
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
};

class TorrentJob {
  constructor({ id, source, dir, settings, selected, paused, addedAt, onUpdate }) {
    this.id = id;
    this.source = source;
    this.dir = dir;
    this.settings = settings;
    this.paused = !!paused;
    this.addedAt = Number(addedAt) || Date.now();
    this.onUpdate = onUpdate || (() => {});
    this.engine = null;
    this.torrent = null;
    this.files = [];
    this.selected = new Set(Array.isArray(selected) ? selected : []);
    this.infoHash = '';
    this.name = '';
    this.trackers = [];
    this.error = '';
    this.listenPort = 0;
    this.startedAt = 0;
    this._lastSavedName = '';
    this._destroying = false;
    this._parsed = null;
    this._dhtPeers = new Set();
  }

  // Пиры, найденные нашим DHT-клиентом. torrent-stream сам их не увидит,
  // потому что его discovery стартует раньше, чем DHT успевает собрать узлы.
  addPeer(peer) {
    if (!peer || !peer.host || !peer.port || this.paused || this._destroying) return;
    if (!this.engine || typeof this.engine.connect !== 'function') return;
    const addr = `${peer.host}:${peer.port}`;
    if (this._dhtPeers.has(addr)) return;
    if (this._dhtPeers.size > 4000) this._dhtPeers.clear();
    this._dhtPeers.add(addr);
    try {
      this.engine.connect(addr);
    } catch {}
  }

  _prepareMeta() {
    const link = this.source.kind === 'file' ? fs.readFileSync(this.source.value) : String(this.source.value || '');
    const parsed = parseTorrentLink(link);
    if (!parsed || !parsed.infoHash) throw new Error('Не удалось разобрать торрент');
    this._parsed = parsed;
    this.infoHash = String(parsed.infoHash).toLowerCase();
    this.name = parsed.name || this.infoHash.slice(0, 12);
    this.trackers = flattenTrackers(parsed, DEFAULT_TRACKERS);
  }

  start() {
    try {
      this._prepareMeta();
      const link = this.source.kind === 'file' ? fs.readFileSync(this.source.value) : this.source.value;
      const wantPort = Math.min(65535, Math.max(1024, Number(this.settings.port) || 51413));
      const opts = {
        path: this.dir,
        connections: Math.max(2, Number(this.settings.maxPeers) || 60),
        uploads: Math.max(0, Number(this.settings.uploadSlots) || 10),
        // DHT ведёт TorrentService (с собственным bootstrap), но встроенный
        // DHT torrent-stream тоже оставляем включённым: он повторяет announce
        // и находит пиров, даже если внешний клиент не успел собрать узлы.
        dht: this.settings.dht !== false,
        tracker: this.settings.useTrackers !== false,
        trackers: this.trackers,
        verify: true,
        // findPort сначала проверит желаемый порт, а при занятости выберет свободный.
        port: wantPort,
        tmp: path.join(os.tmpdir(), 'archbrowser-torrents'),
      };
      this.engine = loadEngine()(link, opts);
      this.startedAt = Date.now();
      this.engine.on('error', (err) => {
        this.error = err && err.message ? err.message : String(err);
        this.onUpdate();
      });
      this.engine.on('ready', () => this._onReady());
      this.engine.on('torrent', () => this._onReady());
      this.engine.on('idle', () => {
        if (this.engine && this.engine.torrent) this.onUpdate();
      });
      const mark = () => {
        if (this.engine) this.listenPort = this.engine.port || 0;
      };
      try {
        this.engine.listen(0, mark);
      } catch {
        try {
          this.engine.listen(0);
        } catch {}
      }
      if (this.paused) this._deselectAll();
    } catch (err) {
      this.error = err && err.message ? err.message : String(err);
      this.onUpdate();
    }
  }

  _onReady() {
    if (!this.engine || !this.engine.torrent || this.files.length) return;
    this.torrent = this.engine.torrent;
    this.files = this.engine.files || [];
    if (!this.name || this.name === this.infoHash.slice(0, 12)) this.name = this.torrent.name || this.name;
    this.error = '';
    if (this.selected.size === 0 && !this.paused) {
      for (let i = 0; i < this.files.length; i++) this.selected.add(i);
    }
    // torrent-stream по умолчанию выбирает все файлы. Для торрента,
    // добавленного/восстановленного на паузе, сразу снимаем выбор, иначе
    // он успевает начать качать до первого нажатия «Продолжить».
    if (!this.paused) this._applySelection();
    else this._deselectAll();
    this._lastSavedName = this.name;
    this.onUpdate();
  }

  _applySelection() {
    if (!this.engine || !this.files.length) return;
    for (let i = 0; i < this.files.length; i++) {
      const file = this.files[i];
      try {
        if (this.selected.has(i)) file.select();
        else file.deselect();
      } catch {}
    }
  }

  _selectAll() {
    for (let i = 0; i < this.files.length; i++) this.selected.add(i);
    this._applySelection();
  }

  _deselectAll() {
    for (const file of this.files) {
      try {
        file.deselect();
      } catch {}
    }
  }

  _pieceLength() {
    return this.torrent ? Number(this.torrent.pieceLength) || 0 : 0;
  }

  _pieceCount() {
    return this.torrent && this.torrent.pieces ? this.torrent.pieces.length : 0;
  }

  _totalSize() {
    return this.torrent ? Number(this.torrent.length) || 0 : 0;
  }

  _downloadedBytes() {
    if (!this.engine || !this.engine.torrent || !this.engine.bitfield) return 0;
    const total = this._totalSize();
    const pieceLength = this._pieceLength();
    const pieces = this._pieceCount();
    let bytes = 0;
    for (let i = 0; i < pieces; i++) {
      let have = false;
      try {
        have = this.engine.bitfield.get(i);
      } catch {}
      if (!have) continue;
      bytes += i === pieces - 1 ? total - pieceLength * (pieces - 1) : pieceLength;
    }
    return Math.max(0, Math.min(total, bytes));
  }

  _isComplete() {
    const total = this._pieceCount();
    if (!total || !this.engine || !this.engine.bitfield) return false;
    for (let i = 0; i < total; i++) {
      let have = false;
      try {
        have = this.engine.bitfield.get(i);
      } catch {}
      if (!have) return false;
    }
    return true;
  }

  _seeders() {
    const wires = (this.engine && this.engine.swarm && this.engine.swarm.wires) || [];
    const pieces = this._pieceCount();
    let seeds = 0;
    if (!pieces) return 0;
    for (const wire of wires) {
      const have = wire.peerPieces;
      if (!have || !have.length) continue;
      let all = true;
      for (let i = 0; i < pieces; i++) {
        if (!have[i]) {
          all = false;
          break;
        }
      }
      if (all) seeds++;
    }
    return seeds;
  }

  snapshot() {
    const engine = this.engine;
    const ready = !!(engine && engine.torrent);
    const total = ready ? this._totalSize() : 0;
    const downloaded = ready ? this._downloadedBytes() : 0;
    const pieces = ready ? this._pieceCount() : 0;
    const done = downloaded && total
      ? Math.min(pieces, Math.round((downloaded / total) * pieces))
      : 0;
    const swarm = engine && engine.swarm;
    const wires = (swarm && swarm.wires) || [];
    const speed = !this.paused && !this.error && swarm && typeof swarm.downloadSpeed === 'function'
      ? Math.max(0, Math.round(swarm.downloadSpeed()))
      : 0;
    const uploadSpeed = !this.paused && !this.error && swarm && typeof swarm.uploadSpeed === 'function'
      ? Math.max(0, Math.round(swarm.uploadSpeed()))
      : 0;
    const uploaded = swarm ? Math.max(0, Number(swarm.uploaded) || 0) : 0;
    const complete = ready && this._isComplete();
    const state = this.error
      ? 'error'
      : this.paused
        ? 'paused'
        : !ready
          ? 'metadata'
          : complete
            ? 'seeding'
            : 'downloading';
    const seeds = ready ? this._seeders() : 0;
    return {
      id: this.id,
      name: this.name || (this.infoHash ? this.infoHash.slice(0, 12) : 'Новый торрент'),
      infoHash: this.infoHash,
      source: this.source,
      dir: this.dir,
      addedAt: this.addedAt,
      paused: this.paused,
      state,
      error: this.error,
      progress: total ? Math.min(1, downloaded / total) : 0,
      downloaded,
      uploaded,
      total,
      speed,
      uploadSpeed,
      peers: wires.length,
      seeds,
      leechers: Math.max(0, wires.length - seeds),
      ratio: downloaded > 0 ? uploaded / downloaded : 0,
      eta: state === 'downloading' && speed > 0 ? Math.round((total - downloaded) / speed) : 0,
      done,
      pieces,
      pieceLength: ready ? this._pieceLength() : 0,
      trackers: this.trackers,
      listenPort: this.listenPort,
      selected: this.selected.size,
      files: this.files.length,
    };
  }

  peerDetails() {
    const wires = (this.engine && this.engine.swarm && this.engine.swarm.wires) || [];
    return wires.map((wire) => {
      const address = wire.peerAddress || '';
      return {
        address,
        down: wire.downloadSpeed ? Math.max(0, Math.round(wire.downloadSpeed())) : 0,
        up: wire.uploadSpeed ? Math.max(0, Math.round(wire.uploadSpeed())) : 0,
        choked: !!wire.peerChoking,
        interested: !!wire.peerInterested,
        pieces: Array.isArray(wire.peerPieces) ? wire.peerPieces.filter(Boolean).length : 0,
      };
    });
  }

  fileProgress(file) {
    if (!this.engine || !this.engine.bitfield || !this.torrent) return 0;
    const pieceLength = this._pieceLength();
    if (!pieceLength || !file.length) return 0;
    const first = Math.floor(file.offset / pieceLength);
    const last = Math.floor((file.offset + file.length - 1) / pieceLength);
    let have = 0;
    for (let i = first; i <= last; i++) {
      try {
        if (this.engine.bitfield.get(i)) have++;
      } catch {}
    }
    return (last - first + 1) ? have / (last - first + 1) : 0;
  }

  details() {
    const snap = this.snapshot();
    const files = (this.files || []).map((file, index) => ({
      index,
      name: file.name || file.path || `Файл ${index + 1}`,
      path: file.path || file.name || '',
      length: Number(file.length) || 0,
      selected: this.selected.has(index),
      progress: this.fileProgress(file),
    }));
    return { job: snap, files, peers: this.peerDetails() };
  }

  pause() {
    this.paused = true;
    this._deselectAll();
    this.onUpdate();
  }

  resume() {
    this.paused = false;
    if (this.files.length) {
      // Если пользователь уже выбрал отдельные файлы, не сбрасываем выбор.
      if (this.selected.size) this._applySelection();
      else this._selectAll();
    }
    this.onUpdate();
  }

  setFiles(indexes) {
    const next = new Set((indexes || []).map(Number).filter((n) => n >= 0 && n < this.files.length));
    this.selected = next;
    // На паузе только запоминаем выбор: загрузка начнётся после «Продолжить».
    if (!this.paused) this._applySelection();
    this.onUpdate();
  }

  firstFile() {
    for (const file of this.files) {
      const full = path.join(this.dir, file.path || file.name || '');
      try {
        if (fs.statSync(full).isFile()) return full;
      } catch {}
    }
    return '';
  }

  _deleteFiles() {
    const targets = (this.files || []).map((file) => path.resolve(path.join(this.dir, file.path || file.name || '')));
    const root = path.resolve(this.dir);
    for (const target of targets) {
      if (!target.startsWith(root + path.sep)) continue;
      try {
        fs.unlinkSync(target);
      } catch {}
    }
    // Убираем пустые каталоги, но не саму папку загрузок.
    const dirs = new Set();
    for (const target of targets) {
      let dir = path.dirname(target);
      while (dir.startsWith(root + path.sep)) {
        dirs.add(dir);
        dir = path.dirname(dir);
      }
    }
    const sorted = [...dirs].sort((a, b) => b.length - a.length);
    for (const dir of sorted) {
      try {
        fs.rmdirSync(dir);
      } catch {}
    }
  }

  async destroy(deleteData = false) {
    if (this._destroying) return;
    this._destroying = true;
    this.paused = true;
    const files = (this.files || []).slice();
    await new Promise((resolve) => {
      if (!this.engine) return resolve();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      const timer = setTimeout(finish, 2500);
      if (timer.unref) timer.unref();
      try {
        this.engine.destroy(() => {
          clearTimeout(timer);
          finish();
        });
      } catch {
        clearTimeout(timer);
        finish();
      }
    });
    this.engine = null;
    this.files = files;
    if (deleteData) this._deleteFiles();
  }
}

class TorrentService {
  constructor({ userDataDir, getSettings, getDir, onChange }) {
    this.userDataDir = userDataDir;
    this.getSettings = getSettings || (() => ({}));
    this.getDir = getDir || (() => path.join(os.homedir(), 'Downloads'));
    this.onChange = onChange || (() => {});
    this.jobs = new Map();
    this.counter = 0;
    this.storeFile = path.join(userDataDir, 'torrents.json');
    this.items = [];
    this._saveTimer = null;
    this.dht = null;
    this.dhtReady = false;
    this._dhtRetries = 0;
    this._lastDhtLookup = 0;
    this._load();
    this._timer = setInterval(() => this._tick(), 1000);
    if (this._timer.unref) this._timer.unref();
  }

  // Один DHT-клиент на всё приложение: bootstrap выполняется один раз,
  // затем мы ищем пиров для всех активных торрентов.
  _ensureDht() {
    if (this.dht) return this.dht;
    if (!this.settings().dht) return null;
    try {
      const DHT = require('bittorrent-dht');
      const dht = new DHT({ bootstrap: DHT_BOOTSTRAP, timeout: 5000 });
      dht.on('error', (err) => console.error('[torrent] DHT:', err.message));
      dht.on('warning', () => {});
      dht.on('peer', (peer, infoHash) => {
        const hash = infoHash && infoHash.toString ? infoHash.toString('hex') : '';
        if (!hash) return;
        for (const job of this.jobs.values()) {
          if (job.infoHash === hash) job.addPeer(peer);
        }
      });
      dht.on('ready', () => {
        this.dhtReady = true;
        let nodes = 0;
        try {
          nodes = dht.nodes && dht.nodes.toArray ? dht.nodes.toArray().length : 0;
        } catch {}
        // Bootstrap не собрал ни одного узла — пробуем ещё раз, но не бесконечно.
        if (!nodes && this._dhtRetries < 3) {
          this._dhtRetries++;
          try {
            dht.destroy();
          } catch {}
          this.dht = null;
          this.dhtReady = false;
          const timer = setTimeout(() => this._ensureDht(), 12000);
          if (timer.unref) timer.unref();
          return;
        }
        this._dhtLookup(true);
      });
      dht.listen(0);
      this.dht = dht;
    } catch (err) {
      console.error('[torrent] cannot start DHT:', err.message);
      this.dht = null;
    }
    return this.dht;
  }

  _dhtLookup(announce = false) {
    const dht = this._ensureDht();
    if (!dht || !this.dhtReady) return;
    this._lastDhtLookup = Date.now();
    for (const job of this.jobs.values()) {
      if (!job.infoHash || job.paused || !job.engine) continue;
      if (job.engine.torrent && job._isComplete()) continue;
      try {
        dht.lookup(Buffer.from(job.infoHash, 'hex'));
      } catch {}
      // Порт прослушивания становится известен только после engine.listen().
      // Раньше announce делался один раз до этого момента и больше не
      // повторялся — magnet-ссылки без трекеров могли остаться без пиров.
      if (job.listenPort) {
        try {
          dht.announce(job.infoHash, job.listenPort, () => {});
        } catch {}
      }
    }
  }

  stopDht() {
    try {
      if (this.dht) this.dht.destroy();
    } catch {}
    this.dht = null;
    this.dhtReady = false;
  }

  settings() {
    const s = this.getSettings() || {};
    return {
      dir: String(s.torrentDir || this.getDir() || '').trim() || path.join(os.homedir(), 'Downloads'),
      port: Math.min(65535, Math.max(1024, Number(s.torrentPort) || 51413)),
      maxPeers: Math.max(2, Math.min(500, Number(s.torrentMaxPeers) || 60)),
      uploadSlots: Math.max(0, Math.min(200, Number(s.torrentUploadSlots) || 10)),
      dht: s.torrentDht !== false,
      useTrackers: s.torrentUseTrackers !== false,
      seedRatio: Math.max(0, Number(s.torrentSeedRatio) || 0),
      resumeOnStart: s.torrentResumeOnStart !== false,
      startPaused: !!s.torrentStartPaused,
    };
  }

  enabled() {
    const s = this.getSettings() || {};
    return s.featureBittorrent !== false;
  }

  _load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.storeFile, 'utf8'));
      this.items = Array.isArray(parsed) ? parsed : Array.isArray(parsed.items) ? parsed.items : [];
    } catch {
      this.items = [];
    }
  }

  _saveNow() {
    clearTimeout(this._saveTimer);
    this._saveTimer = null;
    const text = JSON.stringify({ items: this.items }, null, 0);
    try {
      fs.mkdirSync(path.dirname(this.storeFile), { recursive: true });
      const tmp = `${this.storeFile}.tmp`;
      fs.writeFileSync(tmp, text, 'utf8');
      fs.renameSync(tmp, this.storeFile);
    } catch (err) {
      console.error('[torrent] cannot save queue:', err.message);
    }
  }

  _persist() {
    this.items = [...this.jobs.values()].map((job) => ({
      id: job.id,
      source: job.source,
      dir: job.dir,
      selected: [...job.selected],
      paused: job.paused,
      addedAt: job.addedAt,
      name: job.name,
    }));
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._saveNow(), 350);
  }

  _touch() {
    this._persist();
    this.onChange();
  }

  _tick() {
    if (!this.jobs.size) return;
    let hasActive = false;
    for (const job of this.jobs.values()) {
      // Останавливаем раздачу, когда достигнут заданный рейтинг.
      const snap = job.snapshot();
      if (snap.state === 'seeding' && this.settings().seedRatio > 0
        && snap.ratio >= this.settings().seedRatio) {
        job.pause();
        this._persist();
      }
      if (!job.paused && job.infoHash) hasActive = true;
    }
    // Периодически обновляем пиров через DHT: трекеры могут быть недоступны,
    // а таблица DHT со временем меняется.
    if (hasActive && Date.now() - this._lastDhtLookup > 90000) {
      this._dhtLookup(false);
    }
  }

  list() {
    return [...this.jobs.values()].map((job) => job.snapshot());
  }

  stats() {
    const jobs = this.list();
    return {
      downloadSpeed: jobs.reduce((sum, job) => sum + job.speed, 0),
      uploadSpeed: jobs.reduce((sum, job) => sum + job.uploadSpeed, 0),
      active: jobs.filter((job) => job.state === 'downloading' || job.state === 'metadata').length,
      paused: jobs.filter((job) => job.state === 'paused').length,
      seeding: jobs.filter((job) => job.state === 'seeding').length,
      errors: jobs.filter((job) => job.state === 'error').length,
      total: jobs.length,
    };
  }

  details(id) {
    const job = this.jobs.get(id);
    if (!job) return null;
    return job.details();
  }

  async add(source, { paused = false, dir = '' } = {}) {
    if (!this.enabled()) throw new Error('BitTorrent-клиент выключен в настройках');
    if (!source || !source.value) throw new Error('Пустая ссылка на торрент');
    if (source.kind !== 'magnet' && source.kind !== 'file') throw new Error('Неизвестный источник торрента');
    const settings = this.settings();
    const targetDir = String(dir || settings.dir || '').trim() || settings.dir;
    try {
      fs.mkdirSync(targetDir, { recursive: true });
    } catch (err) {
      throw new Error(`Папка загрузок недоступна: ${err.message}`);
    }
    this.counter++;
    const id = `torrent-${Date.now()}-${this.counter}`;
    const job = new TorrentJob({
      id,
      source,
      dir: targetDir,
      settings,
      paused: !!paused || settings.startPaused,
      onUpdate: () => this._touch(),
    });
    this.jobs.set(id, job);
    this._persist();
    this.onChange();
    job.start();
    this._dhtLookup(true);
    // Порт прослушивания появляется через мгновение после listen() —
    // повторяем announce, чтобы DHT узнал о нас.
    const announceTimer = setTimeout(() => this._dhtLookup(true), 5000);
    if (announceTimer.unref) announceTimer.unref();
    return id;
  }

  async addUrl(url, options = {}) {
    const text = String(url || '').trim();
    if (!/^https?:\/\//i.test(text)) throw new Error('Нужна magnet-ссылка или адрес .torrent');
    const file = path.join(this.userDataDir, 'torrents', `url-${crypto.createHash('sha1').update(text).digest('hex').slice(0, 16)}.torrent`);
    await downloadTorrent(text, file);
    return this.add({ kind: 'file', value: file }, options);
  }

  pause(id) {
    const job = this.jobs.get(id);
    if (!job) return false;
    job.pause();
    this._persist();
    return true;
  }

  resume(id) {
    const job = this.jobs.get(id);
    if (!job) return false;
    job.resume();
    this._persist();
    return true;
  }

  pauseAll() {
    for (const job of this.jobs.values()) job.pause();
    this._persist();
  }

  resumeAll() {
    for (const job of this.jobs.values()) job.resume();
    this._persist();
  }

  setFiles(id, files) {
    const job = this.jobs.get(id);
    if (!job) return false;
    job.setFiles(files);
    this._persist();
    return true;
  }

  async remove(id, { deleteData = false } = {}) {
    const job = this.jobs.get(id);
    if (!job) return false;
    await job.destroy(deleteData);
    this.jobs.delete(id);
    this._persist();
    this.onChange();
    return true;
  }

  downloadDir(id) {
    const job = this.jobs.get(id);
    return job ? job.dir : this.settings().dir;
  }

  firstFile(id) {
    const job = this.jobs.get(id);
    return job ? job.firstFile() : '';
  }

  restoreLater() {
    const timer = setTimeout(() => {
      this.restore().catch((err) => console.error('[torrent] restore:', err.message));
    }, 2500);
    if (timer.unref) timer.unref();
  }

  async restore() {
    if (!this.enabled()) return;
    const settings = this.settings();
    if (!settings.resumeOnStart) return;
    this._load();
    for (const item of this.items.slice(0, 100)) {
      if (!item || !item.source || this.jobs.has(item.id)) continue;
      if (item.source.kind === 'file' && !fs.existsSync(item.source.value)) continue;
      const id = item.id || `torrent-${Date.now()}-${++this.counter}`;
      const job = new TorrentJob({
        id,
        source: item.source,
        dir: item.dir || settings.dir,
        settings,
        selected: item.selected,
        paused: item.paused !== false,
        addedAt: item.addedAt,
        onUpdate: () => this._touch(),
      });
      this.jobs.set(id, job);
      job.start();
    }
    this._persist();
    this.onChange();
    this._dhtLookup(true);
    const announceTimer = setTimeout(() => this._dhtLookup(true), 5000);
    if (announceTimer.unref) announceTimer.unref();
  }

  async stopAll() {
    const jobs = [...this.jobs.values()];
    await Promise.all(jobs.map((job) => job.destroy(false).catch(() => {})));
    this.jobs.clear();
    clearTimeout(this._saveTimer);
    this._saveTimer = null;
    this.stopDht();
    this._saveNow();
  }
}

function downloadTorrent(url, target, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('Слишком много перенаправлений'));
    const client = /^https:/i.test(url) ? https : http;
    let request;
    try {
      request = client.get(url, {
        headers: { 'user-agent': 'ArchBrowser/1.0', accept: 'application/x-bittorrent,*/*' },
        timeout: 30000,
      }, (response) => {
        const status = response.statusCode || 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          const next = new URL(response.headers.location, url).toString();
          return downloadTorrent(next, target, redirects + 1).then(resolve, reject);
        }
        if (status !== 200) {
          response.resume();
          return reject(new Error(`Сервер вернул ${status}`));
        }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const out = fs.createWriteStream(target);
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > 32 * 1024 * 1024) {
            request.destroy(new Error('Файл .torrent слишком большой'));
          }
        });
        response.pipe(out);
        out.on('finish', () => out.close(() => resolve(target)));
        out.on('error', reject);
      });
    } catch (err) {
      return reject(err);
    }
    request.on('timeout', () => request.destroy(new Error('Таймаут загрузки .torrent')));
    request.on('error', reject);
  });
}

module.exports = {
  TorrentService,
  TorrentJob,
  DEFAULT_TRACKERS,
  parseTorrentLink,
  flattenTrackers,
  pluralBytes,
};
