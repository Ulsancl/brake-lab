const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('brakeDesktop', {
  isDesktop: true,
  openProject: () => ipcRenderer.invoke('brake:open-project'),
  saveProject: payload => ipcRenderer.invoke('brake:save-project', payload),
  setBusy: busy => ipcRenderer.send('brake:busy', busy === true),
  onCommand: callback => {
    if (typeof callback !== 'function') throw new TypeError('A callback is required');
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('brake:command', listener);
    return () => ipcRenderer.removeListener('brake:command', listener);
  },
});
