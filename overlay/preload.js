'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// The page draws; the main process owns the window. Nothing else crosses.
contextBridge.exposeInMainWorld('overlay', {
  // Moving the bar. Two signals and nothing else: the page never gets to
  // say WHERE the window goes, only that a drag is happening.
  dragStart: () => ipcRenderer.send('overlay:drag-start'),
  dragEnd: () => ipcRenderer.send('overlay:drag-end'),
  // Everything the page asks the harness for goes through this one door, and
  // only the method+path pairs in requests.js are accepted on the other side.
  request: (path, options) => ipcRenderer.invoke('overlay:request', path, options),
  close: () => ipcRenderer.send('overlay:close'),
  // Sin argumentos a propósito: la dirección la sabe el proceso principal, y
  // esta página no puede elegir qué se abre.
  abrirWeb: () => ipcRenderer.send('overlay:web'),
  setShape: (shape) => ipcRenderer.send('overlay:set-shape', shape),
  onShape: (fn) => ipcRenderer.on('overlay:shape', (_event, shape) => fn(shape)),
  keysList: () => ipcRenderer.invoke('overlay:keys-list'),
  captureMode: (open) => ipcRenderer.invoke('overlay:capture-mode', open),
  keySet: (action, accelerator) => ipcRenderer.invoke('overlay:key-set', action, accelerator),
  onKeyProblem: (fn) => ipcRenderer.on('overlay:key-problem', (_event, message) => fn(message)),
  // La tecla del menú: la atiende el proceso principal sin salir al arnés.
  onMenuToggle: (fn) => ipcRenderer.on('overlay:menu-toggle', () => fn()),
});
