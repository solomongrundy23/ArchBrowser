'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Окно уведомлений: получает текст и тип сообщения от главного процесса.
contextBridge.exposeInMainWorld('archToast', {
  onData: (callback) => {
    ipcRenderer.on('toast:data', (_event, data) => {
      try {
        callback(data || {});
      } catch {}
    });
  },
});
