// SPDX-License-Identifier: AGPL-3.0-or-later
const { app, BrowserWindow, dialog, ipcMain, net, protocol, session, Menu } = require('electron')
const { open } = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const origin = 'pageglade://app'
const root = path.resolve(__dirname, '..', 'dist')
const maxFile = 150 * 1024 * 1024
let window
let pending
let rendererReady = false

protocol.registerSchemesAsPrivileged([{
  scheme: 'pageglade',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}])

async function readBook(filename) {
  if (path.extname(filename).toLowerCase() !== '.epub') throw new Error('Choose an EPUB book.')
  const file = await open(filename, 'r')
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > maxFile) throw new Error('This EPUB is too large.')
    const bytes = new Uint8Array(stat.size)
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await file.read({ buffer: bytes, offset, length: bytes.length - offset })
      if (!bytesRead) throw new Error('Could not read the entire book.')
      offset += bytesRead
    }
    return { name: path.basename(filename), bytes }
  } finally {
    await file.close()
  }
}

async function deliver() {
  if (!rendererReady || !window || !pending) return
  const filename = pending
  pending = undefined
  const target = window
  try {
    const book = await readBook(filename)
    if (!target.isDestroyed()) target.webContents.send('book:open', book)
  } catch {
    if (!target.isDestroyed()) await dialog.showMessageBox(target, {
      type: 'warning', message: 'Pageglade could not open that EPUB.', detail: 'Try a local copy under 150 MB.',
    })
  }
}

function accept(filename) {
  if (filename && path.isAbsolute(filename) && path.extname(filename).toLowerCase() === '.epub') {
    pending = filename
    void deliver()
  }
}

function trusted(event) {
  return window && !window.isDestroyed() && event.sender === window.webContents
    && event.senderFrame === window.webContents.mainFrame
    && event.senderFrame.url === origin + '/index.html'
}

function createWindow() {
  rendererReady = false
  window = new BrowserWindow({
    width: 1150, height: 800, minWidth: 440, minHeight: 470, title: 'Pageglade',
    backgroundColor: '#f4f3ed',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), sandbox: true,
      contextIsolation: true, nodeIntegration: false, spellcheck: false,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.on('closed', () => { window = undefined; rendererReady = false })
  void window.loadURL(origin + '/index.html')
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  accept(process.argv.find(value => path.isAbsolute(value) && /\.epub$/i.test(value)))
  app.on('open-file', (event, filename) => { event.preventDefault(); accept(filename) })
  app.on('second-instance', (_event, argv) => {
    accept(argv.find(value => path.isAbsolute(value) && /\.epub$/i.test(value)))
    if (!window && app.isReady()) createWindow()
    if (window?.isMinimized()) window.restore()
    window?.focus()
  })
  app.whenReady().then(() => {
    protocol.handle('pageglade', request => {
      const url = new URL(request.url)
      if (url.hostname !== 'app') return new Response(null, { status: 404 })
      let filename
      try {
        filename = path.resolve(root, '.' + decodeURIComponent(url.pathname))
      } catch {
        return new Response(null, { status: 400 })
      }
      const rel = path.relative(root, filename)
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return new Response(null, { status: 403 })
      return net.fetch(pathToFileURL(filename).href)
    })
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] },
      (_request, callback) => callback({ cancel: true }))
    ipcMain.handle('book:choose', async event => {
      if (!trusted(event)) return null
      const result = await dialog.showOpenDialog(window, {
        properties: ['openFile'], filters: [{ name: 'EPUB books', extensions: ['epub'] }],
      })
      return result.canceled ? null : readBook(result.filePaths[0])
    })
    ipcMain.on('book:ready', event => {
      if (!trusted(event)) return
      rendererReady = true
      void deliver()
    })
    ipcMain.on('app:quit', event => { if (trusted(event)) app.quit() })
    if (process.platform !== 'darwin') Menu.setApplicationMenu(null)
    createWindow()
  })
  app.on('activate', () => { if (!window) createWindow() })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}
