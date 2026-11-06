import { app, BrowserWindow, dialog, protocol, net, screen, shell } from 'electron'
import { appendFileSync } from 'node:fs'
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

// Packaged GUI apps have no visible console, so errors go to %APPDATA%/Server Manager/main.log.
function log(...parts: unknown[]): void {
  const line = `[${new Date().toISOString()}] ${parts
    .map((p) => (p instanceof Error ? `${p.message}\n${p.stack}` : String(p)))
    .join(' ')}\n`
  console.log(line.trimEnd())
  try {
    appendFileSync(join(app.getPath('userData'), 'main.log'), line)
  } catch {
    /* ignore */
  }
}

process.on('uncaughtException', (err) => log('uncaughtException', err))
process.on('unhandledRejection', (err) => log('unhandledRejection', err))

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

  // ready-to-show does not reliably fire in the packaged Windows build, so the
  // window is also revealed on did-finish-load and by a timeout fallback.
  const reveal = (reason: string): void => {
    if (!mainWindow || mainWindow.isVisible()) return
    const { workArea } = screen.getPrimaryDisplay()
    const [w, h] = mainWindow.getSize()
    mainWindow.setPosition(
      workArea.x + Math.max(0, Math.round((workArea.width - w) / 2)),
      workArea.y + Math.max(0, Math.round((workArea.height - h) / 2))
    )
    mainWindow.show()
    mainWindow.focus()
    log(`window shown (${reason})`)
  }
  mainWindow.once('ready-to-show', () => reveal('ready-to-show'))
  mainWindow.webContents.once('did-finish-load', () => reveal('did-finish-load'))
  setTimeout(() => reveal('timeout'), 4000)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadURL('app://bundle/index.html')
  }

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    log(`renderer did-fail-load ${code} ${desc} ${url}`)
    reveal('did-fail-load')
  })
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    log('render-process-gone', JSON.stringify(details))
  })
  mainWindow.webContents.on('preload-error', (_e, path, err) => {
    log('preload-error', path, err)
  })
  mainWindow.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) log(`renderer console: ${message} (${source}:${line})`)
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
  log(`starting v${app.getVersion()} userData=${app.getPath('userData')}`)
  try {
    if (!isDev) registerAppProtocol()
    initDb()
    registerIpc(getMainWindow)
    createWindow()
    scheduleAutoRefresh()
  } catch (err) {
    log('startup failed', err)
    dialog.showErrorBox('Server Manager failed to start', String(err instanceof Error ? err.stack : err))
    app.quit()
    return
  }

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
