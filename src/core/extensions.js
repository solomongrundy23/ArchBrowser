'use strict';

const fs = require('fs');
const path = require('path');
const { dialog, webContents } = require('electron');

class ExtensionsManager {
  constructor({ dir, getSettings, onChanged }) {
    this.dir = dir;
    this.getSettings = getSettings;
    this.onChanged = onChanged || (() => {});
    this.items = []; // { id, name, version, path, folder, enabled, error }
    fs.mkdirSync(this.dir, { recursive: true });
  }

  isDisabled(folder) {
    const list = this.getSettings().disabledExtensions || [];
    return list.includes(folder);
  }

  // Копирует встроенное расширение в профиль пользователя при первом запуске.
  installBundled(srcDir, folder) {
    const manifest = path.join(srcDir, 'manifest.json');
    if (!fs.existsSync(manifest)) return false;
    const target = path.join(this.dir, folder);
    const sourceVersion = path.join(srcDir, 'arch-build.txt');
    const targetVersion = path.join(target, 'arch-build.txt');
    const wanted = fs.existsSync(sourceVersion)
      ? fs.readFileSync(sourceVersion, 'utf8').trim()
      : '';
    const current = fs.existsSync(targetVersion)
      ? fs.readFileSync(targetVersion, 'utf8').trim()
      : '';
    const installed = fs.existsSync(path.join(target, 'manifest.json'));
    if (installed && (!wanted || wanted === current)) return false;
    if (installed) fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(srcDir, target, { recursive: true });
    console.log(`[extensions] установлено встроенное расширение: ${folder}`);
    return true;
  }

  // Electron 44 создаёт webContents для background page, но не загружает его.
  // Запускаем страницу вручную, иначе MV2-расширения вроде uBlock не работают.
  async loadExtensionWithBackground(api, target) {
    const before = new Set(
      webContents.getAllWebContents().filter((wc) => wc.getType() === 'backgroundPage'),
    );
    const ext = await api.loadExtension(target, { allowFileAccess: true });
    let manifest = {};
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(target, 'manifest.json'), 'utf8'));
    } catch {}
    const page = manifest.background && manifest.background.page;
    if (page) {
      let bg = null;
      for (let i = 0; i < 10 && !bg; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        bg = webContents
          .getAllWebContents()
          .find((wc) => wc.getType() === 'backgroundPage' && !before.has(wc));
      }
      if (bg && !bg.getURL()) {
        bg.loadURL(`chrome-extension://${ext.id}/${page}`).catch((err) => {
          const message = String((err && err.message) || err || '');
          if (!/ERR_ABORTED|\(-3\)/.test(message)) {
            console.warn('[extensions] background page:', message);
          }
        });
      }
    }
    return ext;
  }

  async loadAll(ses) {
    this.items = [];
    let entries = [];
    try {
      entries = fs.readdirSync(this.dir, { withFileTypes: true });
    } catch {
      return this.items;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = path.join(this.dir, entry.name);
      const manifestPath = path.join(full, 'manifest.json');
      if (!fs.existsSync(manifestPath)) continue;

      let manifest = {};
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      } catch {}
      const optionsPage =
        (manifest.options_ui && manifest.options_ui.page) || manifest.options_page || null;
      const bundled = fs.existsSync(path.join(full, 'arch-build.txt'));

      if (this.isDisabled(entry.name)) {
        this.items.push({
          id: null,
          name: manifest.name || entry.name,
          version: manifest.version || '',
          path: full,
          folder: entry.name,
          enabled: false,
          error: null,
          optionsPage,
          bundled,
        });
        continue;
      }

      try {
        const api = ses.extensions || ses;
        const ext = await this.loadExtensionWithBackground(api, full);
        this.items.push({
          id: ext.id,
          name: ext.name || entry.name,
          version: ext.version || '',
          path: ext.path || full,
          folder: entry.name,
          enabled: true,
          error: null,
          optionsPage,
          bundled,
        });
      } catch (err) {
        this.items.push({
          id: null,
          name: entry.name,
          version: '',
          path: full,
          folder: entry.name,
          enabled: false,
          error: err.message,
          optionsPage,
          bundled,
        });
      }
    }

    console.log(`[extensions] loaded ${this.items.filter((i) => i.enabled).length}/${this.items.length}`);
    return this.items;
  }

  list() {
    return this.items;
  }

  uniqueFolder(base) {
    let name = base.replace(/[^\w.-]+/g, '-') || 'extension';
    let candidate = name;
    let i = 2;
    while (fs.existsSync(path.join(this.dir, candidate))) {
      candidate = `${name}-${i++}`;
    }
    return candidate;
  }

  async loadFromPath(ses, srcPath) {
    const stat = fs.statSync(srcPath);
    if (!stat.isDirectory()) throw new Error('Нужно выбрать папку с распакованным расширением');
    const manifestPath = path.join(srcPath, 'manifest.json');
    if (!fs.existsSync(manifestPath)) throw new Error('В папке нет manifest.json');

    let target = srcPath;
    const inside = path.resolve(srcPath).toLowerCase().startsWith(path.resolve(this.dir).toLowerCase());
    if (!inside) {
      const folder = this.uniqueFolder(path.basename(srcPath));
      target = path.join(this.dir, folder);
      fs.cpSync(srcPath, target, { recursive: true });
    }

    const ext = await this.loadExtensionWithBackground(ses.extensions || ses, target);
    const folder = path.basename(target);
    let manifest = {};
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(target, 'manifest.json'), 'utf8'));
    } catch {}
    const item = {
      id: ext.id,
      name: ext.name || folder,
      version: ext.version || '',
      path: target,
      folder,
      enabled: true,
      error: null,
      optionsPage:
        (manifest.options_ui && manifest.options_ui.page) || manifest.options_page || null,
      bundled: fs.existsSync(path.join(target, 'arch-build.txt')),
    };
    const existing = this.items.findIndex((i) => i.folder === folder);
    if (existing >= 0) this.items[existing] = item;
    else this.items.push(item);
    this.onChanged();
    return item;
  }

  async pickAndLoad(ses, win) {
    const result = await dialog.showOpenDialog(win, {
      title: 'Выберите папку с распакованным расширением',
      properties: ['openDirectory'],
      buttonLabel: 'Загрузить',
    });
    if (result.canceled || !result.filePaths.length) return null;
    return this.loadFromPath(ses, result.filePaths[0]);
  }

  async remove(ses, folder) {
    const item = this.items.find((i) => i.folder === folder);
    if (!item) return false;
    if (item.bundled) throw new Error('Встроенное расширение нельзя удалить, его можно только отключить');
    try {
      if (item.id) (ses.extensions || ses).removeExtension(item.id);
    } catch {}
    const target = path.join(this.dir, folder);
    try {
      await fs.promises.rm(target, { recursive: true, force: true });
    } catch (err) {
      throw new Error('Не удалось удалить папку расширения: ' + err.message);
    }
    this.items = this.items.filter((i) => i.folder !== folder);
    const disabled = (this.getSettings().disabledExtensions || []).filter((f) => f !== folder);
    this.getSettings().disabledExtensions = disabled;
    this.onChanged();
    return true;
  }

  async setEnabled(ses, folder, enabled) {
    const item = this.items.find((i) => i.folder === folder);
    if (!item) return false;
    const disabled = new Set(this.getSettings().disabledExtensions || []);
    if (enabled) disabled.delete(folder);
    else disabled.add(folder);
    this.getSettings().disabledExtensions = [...disabled];

    // Мгновенно выгружаем при отключении; для включения нужен перезапуск.
    if (!enabled && item.id) {
      try {
        (ses.extensions || ses).removeExtension(item.id);
      } catch {}
      item.enabled = false;
      item.id = null;
    } else {
      item.enabled = enabled;
    }
    this.onChanged();
    return true;
  }
}

module.exports = { ExtensionsManager };
