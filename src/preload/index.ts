import { contextBridge, ipcRenderer } from 'electron'
import type { ServerManagerApi } from '@shared/api'

const invoke = <T = unknown>(channel: string, ...args: unknown[]) =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>

const api: ServerManagerApi = {
  settings: {
    get: () => invoke('settings:get'),
    update: (patch) => invoke('settings:update', patch)
  },
  credentials: {
    list: () => invoke('credentials:list'),
    save: (input) => invoke('credentials:save', input),
    remove: (id) => invoke('credentials:remove', id),
    setDefault: (id) => invoke('credentials:setDefault', id)
  },
  servers: {
    list: () => invoke('servers:list'),
    save: (input) => invoke('servers:save', input),
    remove: (id) => invoke('servers:remove', id),
    testConnection: (id) => invoke('servers:testConnection', id),
    getSnapshot: (id) => invoke('servers:getSnapshot', id),
    listSnapshots: () => invoke('servers:listSnapshots'),
    refresh: (id) => invoke('servers:refresh', id),
    refreshAll: () => invoke('servers:refreshAll')
  },
  scan: {
    start: (subnet) => invoke('scan:start', subnet),
    cancel: () => invoke('scan:cancel')
  },
  jobs: {
    run: (input) => invoke('jobs:run', input),
    runMany: (inputs) => invoke('jobs:runMany', inputs),
    list: (serverId) => invoke('jobs:list', serverId),
    get: (id) => invoke('jobs:get', id),
    cancel: (id) => invoke('jobs:cancel', id)
  },
  terminal: {
    open: (serverId, opts) => invoke('terminal:open', serverId, opts),
    write: (sessionId, data) => invoke('terminal:write', sessionId, data),
    resize: (sessionId, cols, rows) => invoke('terminal:resize', sessionId, cols, rows),
    close: (sessionId) => invoke('terminal:close', sessionId)
  },
  events: {
    on: (channel, listener) => {
      const wrapped = (_: unknown, payload: unknown) => listener(payload)
      ipcRenderer.on(channel, wrapped)
      return () => ipcRenderer.removeListener(channel, wrapped)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
