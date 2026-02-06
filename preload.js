const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('thoughtPartner', {
  getState: () => ipcRenderer.invoke('state:get'),
  updateState: (partialState) => ipcRenderer.invoke('state:update', partialState),
  evolvePrompts: (payload) => ipcRenderer.invoke('ai:evolvePrompts', payload),
  setHover: (isHovering) => ipcRenderer.send('panel:hover', isHovering),
  setPinned: (isPinned) => ipcRenderer.send('panel:setPinned', isPinned),
  setDock: (dock) => ipcRenderer.send('panel:setDock', dock),
  onAutoPromptCaptured: (handler) => {
    const wrapped = (_event, entry) => handler(entry);
    ipcRenderer.on('timeline:autoPromptCaptured', wrapped);
    return () => ipcRenderer.removeListener('timeline:autoPromptCaptured', wrapped);
  },
  onExpandedChange: (handler) => {
    const wrapped = (_event, expanded) => handler(expanded);
    ipcRenderer.on('panel:expanded', wrapped);
    return () => ipcRenderer.removeListener('panel:expanded', wrapped);
  },
});
