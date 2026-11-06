import type {
  AppSettings,
  Credential,
  CredentialInput,
  Job,
  ScanResult,
  Server,
  ServerInput,
  ServerSnapshot,
  JobType
} from './types'

export interface ServerManagerApi {
  settings: {
    get: () => Promise<AppSettings>
    update: (patch: Partial<AppSettings>) => Promise<AppSettings>
  }
  credentials: {
    list: () => Promise<Credential[]>
    save: (input: CredentialInput) => Promise<Credential>
    remove: (id: string) => Promise<void>
    setDefault: (id: string) => Promise<void>
  }
  servers: {
    list: () => Promise<Server[]>
    save: (input: ServerInput) => Promise<Server>
    remove: (id: string) => Promise<void>
    testConnection: (id: string) => Promise<{ ok: boolean; error?: string }>
    getSnapshot: (id: string) => Promise<ServerSnapshot | null>
    listSnapshots: () => Promise<ServerSnapshot[]>
    refresh: (id: string) => Promise<ServerSnapshot>
    refreshAll: () => Promise<void>
  }
  scan: {
    start: (subnet: string) => Promise<void>
    cancel: () => Promise<void>
  }
  jobs: {
    run: (input: { serverId: string; type: JobType; target?: string }) => Promise<{ jobId: string }>
    runMany: (
      inputs: Array<{ serverId: string; type: JobType; target?: string }>
    ) => Promise<{ jobIds: string[] }>
    list: (serverId?: string) => Promise<Job[]>
    get: (id: string) => Promise<Job | null>
    cancel: (id: string) => Promise<void>
  }
  terminal: {
    open: (serverId: string, opts: { cols: number; rows: number }) => Promise<{ sessionId: string }>
    write: (sessionId: string, data: string) => Promise<void>
    resize: (sessionId: string, cols: number, rows: number) => Promise<void>
    close: (sessionId: string) => Promise<void>
  }
  events: {
    on: (channel: string, listener: (payload: unknown) => void) => () => void
  }
}

declare global {
  interface Window {
    api: ServerManagerApi
  }
}
