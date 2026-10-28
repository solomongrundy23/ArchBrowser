'use strict';

const { contextBridge, ipcRenderer } = require('electron');

let initialTheme = null;
try {
  initialTheme = ipcRenderer.sendSync('theme:get-sync');
} catch {}

contextBridge.exposeInMainWorld('arch', {
  initialTheme,
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
  onState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('state', handler);
    return () => ipcRenderer.removeListener('state', handler);
  },
  onCommand: (callback) => {
    const handler = (_event, command) => callback(command);
    ipcRenderer.on('command', handler);
    return () => ipcRenderer.removeListener('command', handler);
  },
  onFindResult: (callback) => {
    const handler = (_event, result) => callback(result);
    ipcRenderer.on('find-result', handler);
    return () => ipcRenderer.removeListener('find-result', handler);
  },
});
