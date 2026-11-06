import { BrowserWindow, ipcMain } from 'electron'
import {
  deleteCredential,
  deleteServer,
  getJob,
  getServer,
  getSettings,
  getSnapshot,
  listCredentials,
  listJobs,
  listServers,
  listSnapshots,
  saveCredential,
  saveServer,
  setDefaultCredential,
  updateSettings
} from './db'
import { collectAllServers, collectServer } from './collector'
import { scanSubnet, cancelScan } from './scanner'
import { annotateSnapshotsWithImageChecks } from './updateChecker'
import { cancelJob, enqueueJob, enqueueJobs } from './jobRunner'
import { closeTerminal, openTerminal, resizeTerminal, writeTerminal } from './terminalManager'
import { connect } from './ssh/pool'
import { IPC_EVENTS } from '@shared/types'

export function registerIpc(getWin: () => BrowserWindow | null): void {
  // Settings
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:update', (_e, patch) => updateSettings(patch))

  // Credentials
  ipcMain.handle('credentials:list', () => listCredentials())
  ipcMain.handle('credentials:save', (_e, input) => saveCredential(input))
  ipcMain.handle('credentials:remove', (_e, id: string) => deleteCredential(id))
  ipcMain.handle('credentials:setDefault', (_e, id: string) => setDefaultCredential(id))

  // Servers
  ipcMain.handle('servers:list', () => listServers())
  ipcMain.handle('servers:save', (_e, input) => saveServer(input))
  ipcMain.handle('servers:remove', (_e, id: string) => deleteServer(id))
  ipcMain.handle('servers:testConnection', async (_e, id: string) => {
    const server = getServer(id)
    if (!server) return { ok: false, error: 'Server not found' }
    try {
      const c = await connect(server)
      c.close()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('servers:getSnapshot', (_e, id: string) => getSnapshot(id))
  ipcMain.handle('servers:listSnapshots', () => listSnapshots())
  ipcMain.handle('servers:refresh', async (_e, id: string) => {
    const snap = await collectServer(id)
    getWin()?.webContents.send(IPC_EVENTS.snapshotUpdated, snap)
    // kick off image check in background
    void annotateSnapshotsWithImageChecks().then(() => {
      const updated = getSnapshot(id)
      if (updated) getWin()?.webContents.send(IPC_EVENTS.snapshotUpdated, updated)
    })
    return snap
  })
  ipcMain.handle('servers:refreshAll', async () => {
    await collectAllServers((id) => {
      const snap = getSnapshot(id)
      if (snap) getWin()?.webContents.send(IPC_EVENTS.snapshotUpdated, snap)
    })
    await annotateSnapshotsWithImageChecks()
    for (const snap of listSnapshots()) getWin()?.webContents.send(IPC_EVENTS.snapshotUpdated, snap)
  })

  // Scan
  ipcMain.handle('scan:start', async (_e, subnet: string) => {
    const settings = getSettings()
    await scanSubnet(subnet, settings.scanTimeoutMs, (ev) => {
      if (ev.kind === 'progress') getWin()?.webContents.send(IPC_EVENTS.scanProgress, ev)
      if (ev.kind === 'found') getWin()?.webContents.send(IPC_EVENTS.scanFound, ev.result)
      if (ev.kind === 'done') getWin()?.webContents.send(IPC_EVENTS.scanDone, ev.results)
    })
  })
  ipcMain.handle('scan:cancel', () => cancelScan())

  // Jobs
  ipcMain.handle('jobs:run', (_e, input) => ({ jobId: enqueueJob(input, getWin) }))
  ipcMain.handle('jobs:runMany', (_e, inputs) => ({ jobIds: enqueueJobs(inputs, getWin) }))
  ipcMain.handle('jobs:list', (_e, serverId?: string) => listJobs(serverId))
  ipcMain.handle('jobs:get', (_e, id: string) => getJob(id))
  ipcMain.handle('jobs:cancel', (_e, id: string) => cancelJob(id))

  // Terminal
  ipcMain.handle('terminal:open', async (_e, serverId: string, opts: { cols: number; rows: number }) => {
    const sessionId = await openTerminal(serverId, opts.cols, opts.rows, getWin)
    return { sessionId }
  })
  ipcMain.handle('terminal:write', (_e, sessionId: string, data: string) => writeTerminal(sessionId, data))
  ipcMain.handle('terminal:resize', (_e, sessionId: string, cols: number, rows: number) =>
    resizeTerminal(sessionId, cols, rows)
  )
  ipcMain.handle('terminal:close', (_e, sessionId: string) => closeTerminal(sessionId))
}
