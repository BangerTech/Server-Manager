// Types shared between main and renderer. Keep this file dependency-free.

export type AuthType = 'password' | 'key'

export interface Credential {
  id: string
  name: string
  username: string
  authType: AuthType
  isDefault: boolean
  createdAt: number
  // The actual secret never crosses the IPC boundary. Use `hasSecret` instead.
  hasSecret: boolean
}

export interface CredentialInput {
  id?: string
  name: string
  username: string
  authType: AuthType
  secret: string // plaintext over IPC only when writing; encrypted at rest.
  passphrase?: string
  isDefault?: boolean
}

export interface Server {
  id: string
  name: string
  host: string
  port: number
  credentialId: string | null
  color: string
  icon: string
  tags: string[]
  notes: string
  sortOrder: number
  hostKeySha256: string | null
  createdAt: number
}

export interface ServerInput {
  id?: string
  name: string
  host: string
  port?: number
  credentialId?: string | null
  color?: string
  icon?: string
  tags?: string[]
  notes?: string
}

export interface ContainerInfo {
  id: string
  name: string
  image: string
  imageDigest: string | null
  state: string
  status: string
  ports: Array<{ host?: number; container: number; protocol: string }>
  projectName?: string
  updateAvailable?: boolean
  webUrls?: string[]
}

export interface ComposeProject {
  name: string
  status: string
  workingDir: string
  configFiles: string[]
  containers: ContainerInfo[]
}

export interface ServerSnapshot {
  serverId: string
  collectedAt: number
  online: boolean
  error?: string
  osName?: string
  osVersion?: string
  osPretty?: string
  kernel?: string
  hostname?: string
  uptimeSince?: string
  cpuCores?: number
  load1?: number
  load5?: number
  load15?: number
  memTotal?: number
  memUsed?: number
  diskTotal?: number
  diskUsed?: number
  rebootRequired?: boolean
  aptUpgradable?: number
  aptSecurity?: number
  aptList?: Array<{ name: string; from: string; to: string; security: boolean }>
  dockerVersion?: string
  composeProjects?: ComposeProject[]
  standaloneContainers?: ContainerInfo[]
}

export interface ScanResult {
  host: string
  port: number
  sshBanner?: string
  reverseHostname?: string
  openPorts: number[]
}

export type JobType =
  | 'apt-update'
  | 'apt-upgrade'
  | 'apt-full-upgrade'
  | 'compose-pull'
  | 'compose-up'
  | 'compose-restart'
  | 'compose-down'
  | 'image-prune'
  | 'container-restart'
  | 'container-stop'
  | 'container-start'
  | 'reboot'
  | 'custom'

export type JobStatus = 'queued' | 'running' | 'success' | 'error' | 'cancelled'

export interface Job {
  id: string
  serverId: string
  type: JobType
  target: string
  status: JobStatus
  startedAt: number | null
  finishedAt: number | null
  exitCode: number | null
  log: string
}

export interface JobLogChunk {
  jobId: string
  chunk: string
  done: boolean
  status?: JobStatus
  exitCode?: number
}

export interface AppSettings {
  subnet: string
  refreshMinutes: number
  scanTimeoutMs: number
  theme: 'dark' | 'light'
  autoRefresh: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  subnet: '192.168.2.0/24',
  refreshMinutes: 10,
  scanTimeoutMs: 400,
  theme: 'dark',
  autoRefresh: true
}

// IPC channels for events pushed from main -> renderer
export const IPC_EVENTS = {
  scanProgress: 'scan:progress',
  scanFound: 'scan:found',
  scanDone: 'scan:done',
  jobLog: 'job:log',
  snapshotUpdated: 'snapshot:updated',
  terminalData: 'terminal:data',
  terminalExit: 'terminal:exit'
} as const
