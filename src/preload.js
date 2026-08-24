const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('poof', {
  listApps: () => ipcRenderer.invoke('apps:list'),
  quitAll: () => ipcRenderer.invoke('apps:quitAll'),
  toggleKeep: (id) => ipcRenderer.invoke('keep:toggle', id),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  openAutomationSettings: () => ipcRenderer.send('system:openAutomationSettings'),
  relaunch: () => ipcRenderer.send('app:relaunch'),
  hide: () => ipcRenderer.send('window:hide'),
  quitSelf: () => ipcRenderer.send('app:quit'),
  onShown: (fn) => ipcRenderer.on('window:shown', fn),
});
