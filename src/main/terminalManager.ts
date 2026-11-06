import { BrowserWindow } from 'electron'
import { nanoid } from './id'
import { openShell, type ShellHandle } from './ssh/pool'
import { getServer } from './db'
import { IPC_EVENTS } from '@shared/types'

interface Session {
  id: string
  serverId: string
  handle: ShellHandle
}

const sessions = new Map<string, Session>()

export async function openTerminal(
  serverId: string,
  cols: number,
  rows: number,
  getWin: () => BrowserWindow | null
): Promise<string> {
  const server = getServer(serverId)
  if (!server) throw new Error('Server not found')
  const handle = await openShell(server, cols, rows)
  const id = nanoid()
  const session: Session = { id, serverId, handle }
  sessions.set(id, session)
  handle.onData((data) => {
    getWin()?.webContents.send(IPC_EVENTS.terminalData, { sessionId: id, data })
  })
  handle.onExit((code) => {
    getWin()?.webContents.send(IPC_EVENTS.terminalExit, { sessionId: id, code })
    sessions.delete(id)
  })
  return id
}

export function writeTerminal(id: string, data: string): void {
  sessions.get(id)?.handle.write(data)
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  sessions.get(id)?.handle.resize(cols, rows)
}

export function closeTerminal(id: string): void {
  const s = sessions.get(id)
  if (s) {
    s.handle.close()
    sessions.delete(id)
  }
}

export function closeAllTerminals(): void {
  for (const s of sessions.values()) {
    try {
      s.handle.close()
    } catch {
      /* ignore */
    }
  }
  sessions.clear()
}
