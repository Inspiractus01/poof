const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('poof', {
  listApps: () => ipcRenderer.invoke('apps:list'),
  quitAll: () => ipcRenderer.invoke('apps:quitAll'),
  toggleKeep: (id) => ipcRenderer.invoke('keep:toggle', id),
  setRule: (id, hours) => ipcRenderer.invoke('rule:set', id, hours),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  updateState: () => ipcRenderer.invoke('update:state'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  openAutomationSettings: () => ipcRenderer.send('system:openAutomationSettings'),
  relaunch: () => ipcRenderer.send('app:relaunch'),
  hide: () => ipcRenderer.send('window:hide'),
  quitSelf: () => ipcRenderer.send('app:quit'),
  onShown: (fn) => ipcRenderer.on('window:shown', fn),
  onUpdateState: (fn) => ipcRenderer.on('update:state', (_event, state) => fn(state)),
});
