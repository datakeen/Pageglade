// SPDX-License-Identifier: AGPL-3.0-or-later
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pageglade', {
  chooseBook: () => ipcRenderer.invoke('book:choose'),
  onOpen: callback => {
    ipcRenderer.on('book:open', (_event, book) => callback(book))
    ipcRenderer.send('book:ready')
  },
  quit: () => ipcRenderer.send('app:quit'),
})
