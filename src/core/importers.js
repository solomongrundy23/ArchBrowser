'use strict';

// Импорт вкладок и паролей из установленных браузеров.
// Chromium-браузеры хранят вкладки в SNSS-файлах, а пароли — в SQLite
// (Login Data) с ключом, защищённым DPAPI. Firefox использует mozLz4 для
// sessionstore. Модуль только читает данные и ничего не изменяет в чужих
// профилях.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

function exists(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function dirExists(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function safeReadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function tempCopy(file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-import-'));
  const target = path.join(dir, path.basename(file));
  fs.copyFileSync(file, target);
  return { dir, target };
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
}

// ------------------------------------------------------------------ mozLz4

// Firefox sessionstore.jsonlz4: 8-байтная сигнатура, 4-байтный размер
// распакованных данных, затем LZ4-блок.
function mozLz4Decompress(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) throw new Error('Пустой sessionstore');
  if (buf.subarray(0, 8).toString('latin1') !== 'mozLz40\0') {
    throw new Error('Неизвестный формат sessionstore');
  }
  const outSize = buf.readUInt32LE(8);
  if (outSize <= 0 || outSize > 512 * 1024 * 1024) throw new Error('Некорректный размер sessionstore');
  const src = buf.subarray(12);
  const dst = Buffer.allocUnsafe(outSize);
  let ip = 0;
  let op = 0;
  while (ip < src.length && op < outSize) {
    const token = src[ip++];
    let literals = token >>> 4;
    if (literals === 15) {
      let extra;
      do {
        extra = src[ip++];
        literals += extra;
      } while (extra === 255);
    }
    if (op + literals > outSize) literals = outSize - op;
    src.copy(dst, op, ip, Math.min(src.length, ip + literals));
    ip += literals;
    op += literals;
    if (op >= outSize || ip >= src.length) break;
    if (ip + 2 > src.length) break;
    const offset = src[ip] | (src[ip + 1] << 8);
    ip += 2;
    if (!offset || offset > op) throw new Error('Повреждён LZ4-блок');
    let match = token & 0x0f;
    if (match === 15) {
      let extra;
      do {
        extra = src[ip++];
        match += extra;
      } while (extra === 255);
    }
    match += 4;
    for (let i = 0; i < match && op < outSize; i++) {
      dst[op] = dst[op - offset];
      op++;
    }
  }
  if (op !== outSize) throw new Error('Не удалось распаковать sessionstore');
  return dst;
}

// ------------------------------------------------------------------ browsers

function chromiumRoots() {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const roaming = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return [
    { key: 'chrome', name: 'Google Chrome', root: path.join(local, 'Google', 'Chrome', 'User Data') },
    { key: 'edge', name: 'Microsoft Edge', root: path.join(local, 'Microsoft', 'Edge', 'User Data') },
    { key: 'brave', name: 'Brave', root: path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data') },
    { key: 'vivaldi', name: 'Vivaldi', root: path.join(local, 'Vivaldi', 'User Data') },
    { key: 'opera', name: 'Opera', root: path.join(roaming, 'Opera Software', 'Opera Stable') },
    { key: 'opera-gx', name: 'Opera GX', root: path.join(roaming, 'Opera Software', 'Opera GX Stable') },
  ];
}

function chromiumProfileDirs(root) {
  const out = [];
  try {
    for (const name of fs.readdirSync(root)) {
      if (name !== 'Default' && !/^Profile \d+$/i.test(name)) continue;
      const dir = path.join(root, name);
      if (!dirExists(dir)) continue;
      if (exists(path.join(dir, 'Login Data')) || dirExists(path.join(dir, 'Sessions')) || exists(path.join(dir, 'Preferences'))) {
        out.push({ dirName: name, dir });
      }
    }
  } catch {}
  return out;
}

function detectBrowsers() {
  const browsers = [];
  const errors = [];

  for (const desc of chromiumRoots()) {
    if (!dirExists(desc.root)) continue;
    const profiles = chromiumProfileDirs(desc.root);
    for (const profile of profiles) {
      let profileName = profile.dirName;
      const prefs = safeReadJson(path.join(profile.dir, 'Preferences'));
      if (prefs && prefs.profile && prefs.profile.name) profileName = prefs.profile.name;
      const hasTabs = sessionFiles(profile.dir).length > 0;
      const hasPasswords = exists(path.join(profile.dir, 'Login Data'));
      const hasBookmarks = exists(path.join(profile.dir, 'Bookmarks'));
      const hasHistory = exists(path.join(profile.dir, 'History'));
      if (!hasTabs && !hasPasswords && !hasBookmarks && !hasHistory) continue;
      browsers.push({
        id: crypto.createHash('sha1').update(profile.dir).digest('hex').slice(0, 14),
        key: desc.key,
        name: desc.name,
        profile: profileName,
        profileDir: profile.dir,
        kind: 'chromium',
        hasTabs,
        hasPasswords,
        hasBookmarks,
        hasHistory,
      });
    }
  }

  const firefoxRoot = path.join(os.homedir(), 'AppData', 'Roaming', 'Mozilla', 'Firefox', 'Profiles');
  try {
    for (const name of fs.readdirSync(firefoxRoot)) {
      const dir = path.join(firefoxRoot, name);
      if (!dirExists(dir)) continue;
      const hasTabs = [
        'sessionstore.jsonlz4',
        path.join('sessionstore-backups', 'recovery.jsonlz4'),
        path.join('sessionstore-backups', 'previous.jsonlz4'),
      ].some((p) => exists(path.join(dir, p)));
      const hasBookmarks = exists(path.join(dir, 'places.sqlite'));
      const hasHistory = exists(path.join(dir, 'places.sqlite'));
      if (!hasTabs && !hasBookmarks && !hasHistory) continue;
      browsers.push({
        id: crypto.createHash('sha1').update(dir).digest('hex').slice(0, 14),
        key: 'firefox',
        name: 'Mozilla Firefox',
        profile: name.replace(/^[a-z0-9]+\./, ''),
        profileDir: dir,
        kind: 'firefox',
        hasTabs,
        hasPasswords: false,
        hasBookmarks,
        hasHistory,
        passwordsNote: 'Пароли Firefox защищены NSS и не импортируются',
      });
    }
  } catch {}

  if (!browsers.length && errors.length) return { browsers, errors };
  return { browsers, errors };
}

// ------------------------------------------------------------------ Chromium tabs (SNSS)

function sessionFiles(profileDir) {
  const dir = path.join(profileDir, 'Sessions');
  const out = [];
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!/Session|Tabs_/i.test(name)) continue;
      const file = path.join(dir, name);
      if (exists(file)) out.push(file);
    }
  } catch {}
  return out;
}

function readPickleString(buf, offset) {
  if (offset + 4 > buf.length) return null;
  const len = buf.readInt32LE(offset);
  offset += 4;
  if (len < 0 || len > 1024 * 1024 || offset + len > buf.length) return null;
  const value = buf.subarray(offset, offset + len).toString('utf8');
  offset += (len + 3) & ~3;
  return { value, offset };
}

function readPickleInt(buf, offset) {
  if (offset + 4 > buf.length) return null;
  return { value: buf.readInt32LE(offset), offset: offset + 4 };
}

function parseSnss(buf) {
  if (buf.length < 8 || buf.subarray(0, 4).toString('latin1') !== 'SNSS') return [];
  const found = new Map();
  let p = 8;
  while (p + 3 <= buf.length) {
    const size = buf.readUInt16LE(p);
    p += 2;
    if (size < 1 || p + size > buf.length) break;
    const command = buf[p];
    const payload = buf.subarray(p + 1, p + size);
    p += size;
    if (command !== 6 || payload.length < 12) continue;
    try {
      // Pickle: 4-байтный размер, tab_id, index, URL, title.
      let off = 4;
      const tabId = readPickleInt(payload, off);
      if (!tabId) continue;
      off = tabId.offset;
      const index = readPickleInt(payload, off);
      if (!index) continue;
      off = index.offset;
      const url = readPickleString(payload, off);
      if (!url) continue;
      off = url.offset;
      const title = readPickleString(payload, off);
      if (!/^https?:/i.test(url.value)) continue;
      found.set(tabId.value, {
        tabId: tabId.value,
        index: index.value,
        url: url.value,
        title: title ? title.value : '',
      });
    } catch {}
  }
  return [...found.values()];
}

function readChromiumTabs(profileDir) {
  const tabs = [];
  const seen = new Set();
  for (const file of sessionFiles(profileDir)) {
    let tmp;
    try {
      tmp = tempCopy(file);
      const buf = fs.readFileSync(tmp.target);
      let items = parseSnss(buf);
      if (!items.length) {
        // Резервный путь для нестандартных/повреждённых SNSS: находим
        // читаемые URL прямо в бинарном файле.
        const text = buf.toString('latin1');
        const matches = text.match(/https?:\/\/[^\x00-\x20"'<>]{4,2048}/g) || [];
        items = matches.map((url, index) => ({ tabId: index, index, url, title: '' }));
      }
      for (const item of items) {
        const url = String(item.url || '').trim();
        if (!/^https?:/i.test(url) || seen.has(url)) continue;
        seen.add(url);
        tabs.push({ url, title: item.title || '' });
        if (tabs.length >= 80) break;
      }
    } catch (err) {
      // Файл может быть занят браузером; копия должна решить проблему.
    } finally {
      if (tmp) cleanup(tmp.dir);
    }
    if (tabs.length >= 80) break;
  }
  return tabs;
}

// ------------------------------------------------------------------ Firefox tabs

function readFirefoxTabs(profileDir) {
  const candidates = [
    path.join(profileDir, 'sessionstore.jsonlz4'),
    path.join(profileDir, 'sessionstore-backups', 'recovery.jsonlz4'),
    path.join(profileDir, 'sessionstore-backups', 'previous.jsonlz4'),
  ];
  const file = candidates.find(exists);
  if (!file) return [];
  let data;
  try {
    data = JSON.parse(mozLz4Decompress(fs.readFileSync(file)).toString('utf8'));
  } catch {
    return [];
  }
  const out = [];
  const seen = new Set();
  for (const win of data.windows || []) {
    for (const tab of win.tabs || []) {
      const entries = tab.entries || [];
      const entry = entries[Math.max(0, Number(tab.index || 1) - 1)] || entries[entries.length - 1];
      const url = entry && entry.url;
      if (!/^https?:/i.test(url || '') || seen.has(url)) continue;
      seen.add(url);
      out.push({ url, title: entry.title || '' });
      if (out.length >= 80) break;
    }
    if (out.length >= 80) break;
  }
  return out;
}

// ------------------------------------------------------------------ Chromium passwords

function dpapiUnprotect(blob) {
  if (process.platform !== 'win32') throw new Error('DPAPI доступен только в Windows');
  const b64 = Buffer.from(blob).toString('base64');
  const script = [
    'Add-Type -AssemblyName System.Security;',
    `$b=[Convert]::FromBase64String('${b64}');`,
    '$r=[System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,',
    '[System.Security.Cryptography.DataProtectionScope]::CurrentUser);',
    '[Convert]::ToBase64String($r)',
  ].join('');
  const out = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { windowsHide: true, encoding: 'utf8', timeout: 15000 },
  ).trim();
  if (!out) throw new Error('DPAPI вернул пустой ключ');
  return Buffer.from(out, 'base64');
}

const masterKeyCache = new Map();

function chromiumMasterKey(localStatePath) {
  if (masterKeyCache.has(localStatePath)) return masterKeyCache.get(localStatePath);
  const state = safeReadJson(localStatePath);
  const encoded = state && state.os_crypt && state.os_crypt.encrypted_key;
  if (!encoded) throw new Error('В Local State нет ключа шифрования');
  const raw = Buffer.from(encoded, 'base64');
  const prefix = raw.subarray(0, 5).toString('latin1');
  const key = dpapiUnprotect(prefix === 'DPAPI' ? raw.subarray(5) : raw);
  if (key.length !== 32) throw new Error('Неожиданный размер ключа Chromium');
  masterKeyCache.set(localStatePath, key);
  return key;
}

function decryptChromiumPassword(blob, key) {
  if (!Buffer.isBuffer(blob) || !blob.length) return { value: '', skipped: 'empty' };
  const prefix = blob.subarray(0, 3).toString('latin1');
  if (prefix === 'v10' || prefix === 'v11') {
    if (!key) return { value: '', skipped: 'no-key' };
    try {
      const nonce = blob.subarray(3, 15);
      const tag = blob.subarray(blob.length - 16);
      const ciphertext = blob.subarray(15, blob.length - 16);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
      decipher.setAuthTag(tag);
      const value = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
      return { value, skipped: '' };
    } catch {
      return { value: '', skipped: 'auth-failed' };
    }
  }
  if (prefix === 'v20') return { value: '', skipped: 'app-bound' };
  try {
    return { value: blob.toString('utf8'), skipped: '' };
  } catch {
    return { value: '', skipped: 'unknown' };
  }
}

// Chrome не всегда заполняет username_value: логин может лежать в разметке
// поля ввода (username_element). Пытаемся достать его оттуда.
function fallbackUsername(element) {
  if (!element) return '';
  const text = String(element);
  const patterns = [
    /value\s*=\s*["']([^"']{1,200})["']/i,
    /type\s*=\s*["']email["'][^>]*value\s*=\s*["']([^"']{1,200})["']/i,
    />\s*([^<>]{2,120}@[^<>]{2,120})\s*</i,
  ];
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m && m[1]) {
      const value = m[1].trim();
      if (value && !/^password$/i.test(value)) return value;
    }
  }
  return '';
}

function readChromiumPasswords(profileDir, localStatePath) {
  const loginData = path.join(profileDir, 'Login Data');
  if (!exists(loginData)) return { logins: [], skipped: 0 };
  let tmp;
  let db;
  try {
    tmp = tempCopy(loginData);
    const sqlite = require('node:sqlite');
    db = new sqlite.DatabaseSync(tmp.target, { readOnly: true });
    const rows = db.prepare('SELECT origin_url, username_value, username_element, password_value FROM logins').all();
    let key = null;
    let keyError = '';
    try {
      key = chromiumMasterKey(localStatePath);
    } catch (err) {
      keyError = err.message;
    }
    const logins = [];
    let skipped = 0;
    let appBound = 0;
    for (const row of rows) {
      if (!row || !row.origin_url) continue;
      const blob = Buffer.isBuffer(row.password_value) ? row.password_value : Buffer.from(row.password_value || '');
      const result = decryptChromiumPassword(blob, key);
      if (result.skipped === 'app-bound') appBound++;
      if (!result.value) {
        skipped++;
        continue;
      }
      const username = String(row.username_value || '').trim() || fallbackUsername(row.username_element);
      if (!username) {
        skipped++;
        continue;
      }
      let origin = row.origin_url;
      try {
        origin = new URL(row.origin_url).origin;
      } catch {}
      logins.push({
        origin,
        url: row.origin_url,
        username,
        password: result.value,
      });
    }
    if (skipped && keyError) {
      const err = new Error(`Пароли зашифрованы: ${keyError}`);
      err.skipped = skipped;
      err.appBound = appBound;
      throw err;
    }
    return { logins, skipped, appBound };
  } finally {
    try {
      if (db) db.close();
    } catch {}
    if (tmp) cleanup(tmp.dir);
  }
}

// ------------------------------------------------------------------ Chromium bookmarks (JSON)

function readChromiumBookmarks(profileDir) {
  const bookmarksFile = path.join(profileDir, 'Bookmarks');
  if (!exists(bookmarksFile)) return [];
  try {
    const data = safeReadJson(bookmarksFile);
    if (!data || !data.roots) return [];
    const out = [];
    function walk(node, folder = '') {
      if (!node) return;
      if (node.type === 'url' && node.url) {
        out.push({ title: node.name || '', url: node.url, folder });
      } else if (node.type === 'folder' && node.children) {
        const newFolder = folder ? `${folder}/${node.name}` : node.name;
        for (const child of node.children) walk(child, newFolder);
      }
    }
    for (const rootKey of ['bookmark_bar', 'other', 'synced']) {
      if (data.roots[rootKey]) walk(data.roots[rootKey], rootKey === 'bookmark_bar' ? 'Панель закладок' : rootKey === 'other' ? 'Другие' : 'Синхронизированные');
    }
    return out;
  } catch {
    return [];
  }
}

function readFirefoxBookmarks(profileDir) {
  const placesFile = path.join(profileDir, 'places.sqlite');
  if (!exists(placesFile)) return [];
  let tmp;
  let db;
  try {
    tmp = tempCopy(placesFile);
    const sqlite = require('node:sqlite');
    db = new sqlite.DatabaseSync(tmp.target, { readOnly: true });
    const rows = db.prepare(`
      SELECT b.title, p.url
      FROM moz_bookmarks b
      JOIN moz_places p ON b.fk = p.id
      WHERE b.type = 1 AND p.url IS NOT NULL AND p.url NOT LIKE 'place:%'
    `).all();
    return rows.map((row) => ({ title: row.title || '', url: row.url, folder: '' }));
  } catch {
    return [];
  } finally {
    try { if (db) db.close(); } catch {}
    if (tmp) cleanup(tmp.dir);
  }
}

// ------------------------------------------------------------------ Chromium history (SQLite)

function readChromiumHistory(profileDir) {
  const historyFile = path.join(profileDir, 'History');
  if (!exists(historyFile)) return [];
  let tmp;
  let db;
  try {
    tmp = tempCopy(historyFile);
    const sqlite = require('node:sqlite');
    db = new sqlite.DatabaseSync(tmp.target, { readOnly: true });
    const rows = db.prepare(`
      SELECT url, title, last_visit_time / 1000000 as visit_time
      FROM urls
      WHERE last_visit_time > 0
      ORDER BY last_visit_time DESC
    `).all();
    return rows.map((row) => ({ title: row.title || '', url: row.url, visitTime: row.visit_time }));
  } catch {
    return [];
  } finally {
    try { if (db) db.close(); } catch {}
    if (tmp) cleanup(tmp.dir);
  }
}

function readFirefoxHistory(profileDir) {
  const placesFile = path.join(profileDir, 'places.sqlite');
  if (!exists(placesFile)) return [];
  let tmp;
  let db;
  try {
    tmp = tempCopy(placesFile);
    const sqlite = require('node:sqlite');
    db = new sqlite.DatabaseSync(tmp.target, { readOnly: true });
    const rows = db.prepare(`
      SELECT p.url, p.title, p.last_visit_date / 1000000 as visit_time
      FROM moz_places p
      JOIN moz_historyvisits v ON p.id = v.place_id
      WHERE p.url IS NOT NULL AND p.url NOT LIKE 'place:%'
      ORDER BY v.visit_date DESC
    `).all();
    return rows.map((row) => ({ title: row.title || '', url: row.url, visitTime: row.visit_time }));
  } catch {
    return [];
  } finally {
    try { if (db) db.close(); } catch {}
    if (tmp) cleanup(tmp.dir);
  }
}

// ------------------------------------------------------------------ CSV с паролями
// Chrome 127+ шифрует пароли «app-bound», их невозможно прочитать из файла
// профиля. Поэтому поддерживаем импорт из CSV, который сам браузер отдаёт
// в «Настройки → Экспорт паролей».

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (ch === '\r') continue;
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function readPasswordsCsv(file) {
  const result = { logins: [], warnings: [] };
  let text;
  try {
    text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  } catch (err) {
    throw new Error('Не удалось прочитать файл: ' + err.message);
  }
  const rows = parseCsv(text).filter((r) => r.some((cell) => String(cell || '').trim()));
  if (!rows.length) {
    result.warnings.push('Файл пуст');
    return result;
  }
  const header = rows[0].map((cell) => String(cell || '').trim().toLowerCase());
  const hasHeader = header.includes('password') || header.includes('username');
  const idx = {
    url: header.indexOf('url'),
    username: header.indexOf('username'),
    password: header.indexOf('password'),
  };
  const start = hasHeader ? 1 : 0;
  for (let i = start; i < rows.length; i++) {
    const cells = rows[i];
    let url;
    let username;
    let password;
    if (hasHeader) {
      url = String(idx.url >= 0 ? cells[idx.url] || '' : '').trim();
      username = String(idx.username >= 0 ? cells[idx.username] || '' : '').trim();
      password = String(idx.password >= 0 ? cells[idx.password] || '' : '');
    } else {
      // Формат Firefox: url,username,password,...
      url = String(cells[0] || '').trim();
      username = String(cells[1] || '').trim();
      password = String(cells[2] || '');
    }
    if (!password) continue;
    if (!/^https?:\/\//i.test(url)) {
      if (/^[\w.-]+\.[a-zа-я]{2,}(\/.*)?$/i.test(url)) url = 'https://' + url;
      else {
        result.warnings.push(`Пропущена запись без адреса: ${url || '(пусто)'}`);
        continue;
      }
    }
    let origin = url;
    try {
      origin = new URL(url).origin;
    } catch {}
    result.logins.push({ origin, url, username, password });
  }
  return result;
}

// ------------------------------------------------------------------ public

function readBrowser(browser, { tabs = true, passwords = true, bookmarks = false, history = false } = {}) {
  const result = { tabs: [], passwords: [], bookmarks: [], history: [], skipped: 0, appBound: 0, warnings: [] };
  if (!browser || !browser.profileDir) return result;
  if (tabs && browser.hasTabs) {
    try {
      result.tabs = browser.kind === 'firefox'
        ? readFirefoxTabs(browser.profileDir)
        : readChromiumTabs(browser.profileDir);
    } catch (err) {
      result.warnings.push(`Вкладки: ${err.message}`);
    }
  }
  if (passwords && browser.hasPasswords) {
    try {
      const root = path.dirname(browser.profileDir);
      const localState = browser.key.startsWith('opera')
        ? path.join(browser.profileDir, 'Local State')
        : path.join(root, 'Local State');
      const found = readChromiumPasswords(browser.profileDir, localState);
      result.passwords = found.logins;
      result.skipped = found.skipped;
      result.appBound = found.appBound || 0;
      if (result.appBound) {
        // Счётчик уходит отдельным полем: сообщение собирается один раз
        // для всех профилей, чтобы не дублировать его в списке.
        result.warnings.push('app-bound');
      }
    } catch (err) {
      result.warnings.push(`Пароли: ${err.message}`);
    }
  }
  if (bookmarks && browser.hasBookmarks) {
    try {
      result.bookmarks = browser.kind === 'firefox'
        ? readFirefoxBookmarks(browser.profileDir)
        : readChromiumBookmarks(browser.profileDir);
    } catch (err) {
      result.warnings.push(`Закладки: ${err.message}`);
    }
  }
  if (history && browser.hasHistory) {
    try {
      result.history = browser.kind === 'firefox'
        ? readFirefoxHistory(browser.profileDir)
        : readChromiumHistory(browser.profileDir);
    } catch (err) {
      result.warnings.push(`История: ${err.message}`);
    }
  }
  return result;
}

module.exports = {
  detectBrowsers,
  readBrowser,
  readChromiumTabs,
  readFirefoxTabs,
  readChromiumBookmarks,
  readFirefoxBookmarks,
  readChromiumHistory,
  readFirefoxHistory,
  readChromiumPasswords,
  readPasswordsCsv,
  parseCsv,
  mozLz4Decompress,
};
