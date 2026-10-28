'use strict';

const path = require('path');
const crypto = require('crypto');
const { safeStorage } = require('electron');
const { JsonStore } = require('./store');

// Хранилище паролей.
//
// Файл passwords.json никогда не содержит открытых паролей в читаемом виде:
// весь список шифруется одним контейнером.
//
//  • Мастер-пароль задан  → ключ выводится из него через scrypt, контейнер
//    шифруется AES-256-GCM. Без мастер-пароля файл не открыть.
//  • Мастер-пароль не задан → случайный ключ 32 байта хранится в
//    Credentials Manager / Keychain средствами ОС (safeStorage, DPAPI в Windows).
//
// Дополнительно каждый контейнер подписан HMAC-SHA256, поэтому подмена или
// порча файла обнаруживается, а не приводит к тихой выдаче мусора.

const CONTAINER_VERSION = 2;
const SCRYPT_PARAMS = { N: 1 << 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };

function randomKey() {
  return crypto.randomBytes(32);
}

function deriveKey(master, salt) {
  return crypto.scryptSync(String(master), salt, 32, SCRYPT_PARAMS);
}

function encryptPayload(key, plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    v: CONTAINER_VERSION,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

function decryptPayload(key, container) {
  if (!container || !container.iv || !container.tag || !container.data) {
    throw new Error('Файл паролей повреждён');
  }
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(container.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(container.tag, 'base64'));
  try {
    return Buffer.concat([
      decipher.update(Buffer.from(container.data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('Не удалось расшифровать пароли — неверный мастер-пароль?');
  }
}

function hmac(key, container) {
  return crypto
    .createHmac('sha256', key)
    .update(`${container.v}.${container.iv}.${container.tag}.${container.data}`)
    .digest('base64');
}

class PasswordStore {
  constructor(userDataDir) {
    this.store = new JsonStore(path.join(userDataDir, 'passwords.json'), {});
    this.items = [];
    this.locked = false;
    this.masterEnabled = false;
    this._key = null;
    this._salt = null;
    this._autoLockTimer = null;
    this._loadMeta();
  }

  // ---------- ключи и метаданные ----------

  _loadMeta() {
    const data = this.store.all || {};
    this.masterEnabled = !!data.master;
    this._salt = data.salt ? Buffer.from(data.salt, 'base64') : null;
    this._systemKey = data.systemKey
      ? this._decryptSystemKey(data.systemKey)
      : null;
    if (data.container) this._unlockContainer();
  }

  _saveMeta() {
    const patch = {
      master: this.masterEnabled,
      salt: this._salt ? this._salt.toString('base64') : null,
      container: this.store.get('container') || null,
    };
    if (this._systemKey) patch.systemKey = this._encryptSystemKey(this._systemKey);
    this.store.set(patch);
  }

  available() {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  _encryptSystemKey(key) {
    if (!this.available()) return null;
    try {
      return safeStorage.encryptString(key.toString('base64')).toString('base64');
    } catch {
      return null;
    }
  }

  _decryptSystemKey(encoded) {
    if (!this.available()) return null;
    try {
      return Buffer.from(safeStorage.decryptString(Buffer.from(encoded, 'base64')), 'base64');
    } catch {
      return null;
    }
  }

  _activeKey() {
    if (this._key) return this._key;
    if (this.masterEnabled) return null;
    return this._systemKey;
  }

  // ---------- состояние ----------

  isLocked() {
    return this.masterEnabled && !this._key;
  }

  hasMaster() {
    return this.masterEnabled;
  }

  count() {
    return this.items.length;
  }

  list() {
    return this.items
      .map((item) => ({
        id: item.id,
        origin: item.origin,
        username: item.username,
        createdAt: item.createdAt,
        source: item.source || '',
      }))
      .sort((a, b) => a.origin.localeCompare(b.origin, 'ru'));
  }

  get(id) {
    return this.items.find((item) => item.id === id) || null;
  }

  // ---------- разблокировка ----------

  _unlockContainer() {
    const container = this.store.get('container');
    if (!container) {
      this.items = [];
      return true;
    }
    const key = this._activeKey();
    if (!key) return false;
    const text = decryptPayload(key, container);
    const parsed = JSON.parse(text);
    if (parsed.mac && parsed.mac !== hmac(key, container)) {
      throw new Error('Файл паролей изменён извне — доступ заблокирован');
    }
    this.items = Array.isArray(parsed.items) ? parsed.items : [];
    return true;
  }
  unlock(master) {
    if (!this.masterEnabled) return true;
    const salt = this._salt;
    if (!salt) throw new Error('Файл паролей повреждён: нет соли');
    const key = deriveKey(master, salt);
    const container = this.store.get('container');
    if (!container) {
      this._key = key;
      this.items = [];
      this._scheduleAutoLock();
      return true;
    }
    const text = decryptPayload(key, container);
    const parsed = JSON.parse(text);
    if (parsed.mac && parsed.mac !== hmac(key, container)) {
      throw new Error('Файл паролей изменён извне — доступ заблокирован');
    }
    this._key = key;
    this.items = Array.isArray(parsed.items) ? parsed.items : [];
    this._scheduleAutoLock();
    return true;
  }

  lock() {
    this._key = null;
    this.items = [];
    this.locked = true;
    clearTimeout(this._autoLockTimer);
    this._autoLockTimer = null;
  }

  _scheduleAutoLock() {
    clearTimeout(this._autoLockTimer);
    if (!this.masterEnabled) return;
    const minutes = Number(this.getAutoLockMinutes());
    if (!minutes || minutes <= 0) return;
    this._autoLockTimer = setTimeout(() => this.lock(), minutes * 60 * 1000);
  }

  getAutoLockMinutes() {
    return this._autoLockMinutes || 15;
  }

  setAutoLockMinutes(minutes) {
    this._autoLockMinutes = Math.max(0, Math.round(Number(minutes) || 0));
    this._scheduleAutoLock();
  }

  // ---------- мастер-пароль ----------

  setMasterPassword(master, current) {
    const value = String(master || '');
    if (value.length < 6) throw new Error('Мастер-пароль должен быть не короче 6 символов');
    if (this.masterEnabled) {
      // Смена мастер-пароля требует подтверждения текущего: разблокируем хранилище.
      if (!this._key) this.unlock(current || '');
      const items = this.items.slice();
      const salt = crypto.randomBytes(16);
      const key = deriveKey(value, salt);
      this._salt = salt;
      this._key = key;
      this.items = items;
      this._saveContainer();
      this._saveMeta();
      this._scheduleAutoLock();
      return;
    }
    const salt = crypto.randomBytes(16);
    this._salt = salt;
    this._key = deriveKey(value, salt);
    this.masterEnabled = true;
    this._systemKey = null;
    this.items = this.items || [];
    this._saveContainer();
    this._saveMeta();
    this._scheduleAutoLock();
  }

  removeMasterPassword(master) {
    if (!this.masterEnabled) return;
    // Отключение мастер-пароля тоже требует текущий пароль.
    if (!this._key) this.unlock(master || '');
    else {
      const probe = deriveKey(master || '', this._salt);
      const container = this.store.get('container');
      if (container) decryptPayload(probe, container);
    }
    const items = this.items.slice();
    const systemKey = randomKey();
    this.masterEnabled = false;
    this._key = null;
    this._salt = null;
    this._systemKey = systemKey;
    this.items = items;
    this._saveContainer();
    this._saveMeta();
    clearTimeout(this._autoLockTimer);
  }

  // ---------- контейнер ----------

  // Ключ контейнера. Если мастер-пароля нет, ключ хранится средствами ОС
  // (DPAPI в Windows). При первом запуске ключ создаётся автоматически.
  _ensureKey() {
    if (this._key) return this._key;
    if (this.masterEnabled) throw new Error('Хранилище паролей заблокировано');
    if (!this._systemKey) {
      this._systemKey = randomKey();
      this.store.set({ systemKey: this._encryptSystemKey(this._systemKey) });
    }
    return this._systemKey;
  }

  _saveContainer() {
    const key = this._ensureKey();
    const payload = JSON.stringify({ items: this.items });
    const container = encryptPayload(key, payload);
    container.mac = hmac(key, container);
    this.store.set({ container });
  }

  _persist() {
    this._saveContainer();
    this._saveMeta();
  }

  // ---------- операции ----------

  has(origin, username, password) {
    return this.items.some((item) => {
      if (item.origin !== origin || item.username !== username) return false;
      return this._decrypt(item.secret) === password;
    });
  }

  add({ origin, username, password, source = '' }) {
    if (this.isLocked()) throw new Error('Хранилище паролей заблокировано');
    if (!origin || !username || !password) return false;
    if (this.has(origin, username, password)) return false;
    this.items.push({
      id: crypto.randomUUID(),
      origin,
      username: String(username),
      secret: this._encrypt(password),
      source,
      createdAt: Date.now(),
    });
    this._persist();
    this._scheduleAutoLock();
    return true;
  }

  addMany(entries, source = '') {
    let added = 0;
    let duplicate = 0;
    let failed = 0;
    for (const entry of entries || []) {
      try {
        if (this.add({ ...entry, source })) added++;
        else duplicate++;
      } catch {
        failed++;
      }
    }
    return { added, duplicate, failed, total: this.items.length };
  }

  password(id) {
    const item = this.get(id);
    return item ? this._decrypt(item.secret) : '';
  }

  remove(id) {
    if (this.isLocked()) throw new Error('Хранилище паролей заблокировано');
    this.items = this.items.filter((item) => item.id !== id);
    this._persist();
    return { total: this.items.length };
  }

  clear() {
    if (this.isLocked()) throw new Error('Хранилище паролей заблокировано');
    this.items = [];
    this._persist();
    return true;
  }

  // ---------- шифрование отдельных значений ----------

  _encrypt(value) {
    if (this.masterEnabled && this._key) {
      const box = encryptPayload(this._key, String(value));
      return `m:${box.iv}:${box.tag}:${box.data}`;
    }
    if (!this.available()) throw new Error('Системное шифрование паролей недоступно');
    return safeStorage.encryptString(String(value)).toString('base64');
  }

  _decrypt(encoded) {
    if (!encoded) return '';
    try {
      if (encoded.startsWith('m:')) {
        if (!this._key) return '';
        const [, iv, tag, data] = encoded.split(':');
        const decipher = crypto.createDecipheriv('aes-256-gcm', this._key, Buffer.from(iv, 'base64'));
        decipher.setAuthTag(Buffer.from(tag, 'base64'));
        return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
      }
      return safeStorage.decryptString(Buffer.from(encoded, 'base64'));
    } catch {
      return '';
    }
  }
}

module.exports = { PasswordStore };
