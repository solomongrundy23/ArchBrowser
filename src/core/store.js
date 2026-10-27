'use strict';

const fs = require('fs');
const path = require('path');

function readJson(file, fallback) {
  try {
    // Некоторые редакторы сохраняют JSON с BOM — JSON.parse на нём падает,
    // и настройки молча сбрасывались к значениям по умолчанию.
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback;
    return parsed;
  } catch {
    return fallback;
  }
}

class JsonStore {
  constructor(file, defaults = {}) {
    this.file = file;
    this.defaults = defaults;
    this.data = { ...defaults, ...(readJson(file, {}) || {}) };
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
    } catch {}
    this._timer = null;
  }

  get(key) {
    return key === undefined ? this.data : this.data[key];
  }

  get all() {
    return this.data;
  }

  set(patch) {
    Object.assign(this.data, patch);
    this.saveSoon();
    return this.data;
  }

  replace(next) {
    this.data = { ...this.defaults, ...next };
    this.saveSoon();
    return this.data;
  }

  saveSoon() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.save(), 120);
  }

  save() {
    try {
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('[store] cannot save', this.file, err.message);
    }
  }
}

module.exports = { JsonStore, readJson };
