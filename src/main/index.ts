import { app, BrowserWindow, protocol, net, screen, shell } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { initDb, getSettings } from './db'
import { registerIpc } from './ipc'
import { collectAllServers } from './collector'
import { annotateSnapshotsWithImageChecks } from './updateChecker'
import { closeAllTerminals } from './terminalManager'

let mainWindow: BrowserWindow | null = null
let refreshTimer: NodeJS.Timeout | null = null

const isDev = !!process.env.ELECTRON_RENDERER_URL

// Register a custom, secure scheme so the production renderer has a stable origin.
// Loading over file:// gives module scripts an opaque origin, which a strict CSP
// (`script-src 'self'`) then silently blocks -> blank window. app:// avoids that.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
  }
])

function registerAppProtocol(): void {
  const rendererDir = join(__dirname, '../renderer')
  protocol.handle('app', (request) => {
    // URLs look like app://bundle/assets/foo.js -> host "bundle", path the file.
    const url = new URL(request.url)
    let relative = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
    if (!relative || relative.endsWith('/')) relative += 'index.html'
    const filePath = join(rendererDir, relative)
    return net.fetch(pathToFileURL(filePath).toString())
  })
}

function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0d12',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0b0d12',
      symbolColor: '#e5e7eb',
      height: 36
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    // Make sure the window lands on the primary display and is focused, so it
    // can't get "lost" on a disconnected or secondary monitor.
    const { workAreaSize } = screen.getPrimaryDisplay()
    const [w, h] = mainWindow?.getSize() ?? [1400, 900]
    mainWindow?.setPosition(
      Math.max(0, Math.round((workAreaSize.width - w) / 2)),
      Math.max(0, Math.round((workAreaSize.height - h) / 2))
    )
    mainWindow?.show()
    mainWindow?.focus()
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadURL('app://bundle/index.html')
  }

  // Surface load failures instead of showing a silent blank window.
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[renderer] did-fail-load ${code} ${desc} ${url}`)
  })
}

function scheduleAutoRefresh(): void {
  if (refreshTimer) clearInterval(refreshTimer)
  const s = getSettings()
  if (!s.autoRefresh || s.refreshMinutes <= 0) return
  refreshTimer = setInterval(
    () => {
      void collectAllServers((id) => {
        const w = getMainWindow()
        w?.webContents.send('snapshot:updated', { serverId: id })
      }).then(() => annotateSnapshotsWithImageChecks())
    },
    s.refreshMinutes * 60 * 1000
  )
}

app.whenReady().then(() => {
  initDb()
  if (!isDev) registerAppProtocol()
  registerIpc(getMainWindow)
  createWindow()
  scheduleAutoRefresh()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  closeAllTerminals()
  if (refreshTimer) clearInterval(refreshTimer)
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  closeAllTerminals()
})
