import { app, safeStorage } from 'electron'
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { nanoid } from '../id'
import type {
  AppSettings,
  Credential,
  CredentialInput,
  Server,
  ServerInput,
  ServerSnapshot,
  Job,
  JobStatus,
  JobType
} from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'

let db: Database.Database | null = null

function schemaSql(): string {
  // schema.sql sits next to this file in both dev and packaged builds
  const here = typeof __dirname !== 'undefined' ? __dirname : dirname(fileURLToPath(import.meta.url))
  try {
    return readFileSync(join(here, 'schema.sql'), 'utf8')
  } catch {
    // Fallback inline (keep in sync with schema.sql)
    return INLINE_SCHEMA
  }
}

const INLINE_SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS credentials (id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL, auth_type TEXT NOT NULL, secret_encrypted BLOB NOT NULL, passphrase_encrypted BLOB, is_default INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS servers (id TEXT PRIMARY KEY, name TEXT NOT NULL, host TEXT NOT NULL, port INTEGER NOT NULL DEFAULT 22, credential_id TEXT, color TEXT NOT NULL DEFAULT '#6366f1', icon TEXT NOT NULL DEFAULT 'server', tags TEXT NOT NULL DEFAULT '[]', notes TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0, host_key_sha256 TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS server_snapshots (server_id TEXT PRIMARY KEY, collected_at INTEGER NOT NULL, online INTEGER NOT NULL, error TEXT, os_name TEXT, os_version TEXT, os_pretty TEXT, kernel TEXT, hostname TEXT, uptime_since TEXT, cpu_cores INTEGER, load_1 REAL, load_5 REAL, load_15 REAL, mem_total INTEGER, mem_used INTEGER, disk_total INTEGER, disk_used INTEGER, reboot_required INTEGER, apt_upgradable INTEGER, apt_security INTEGER, apt_list TEXT, docker_version TEXT, raw_json TEXT);
CREATE TABLE IF NOT EXISTS image_checks (image_ref TEXT PRIMARY KEY, local_digest TEXT, remote_digest TEXT, update_available INTEGER NOT NULL DEFAULT 0, checked_at INTEGER NOT NULL, error TEXT);
CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, server_id TEXT NOT NULL, type TEXT NOT NULL, target TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, started_at INTEGER, finished_at INTEGER, exit_code INTEGER, log TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS idx_jobs_server ON jobs(server_id, started_at DESC);
CREATE TABLE IF NOT EXISTS known_hosts (host TEXT PRIMARY KEY, key_type TEXT NOT NULL, key_sha256 TEXT NOT NULL, seen_at INTEGER NOT NULL);
`

export function initDb(): Database.Database {
  if (db) return db
  const file = join(app.getPath('userData'), 'server-manager.db')
  db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(schemaSql())
  return db
}

function getDb(): Database.Database {
  if (!db) throw new Error('DB not initialised')
  return db
}

// -- Encryption helpers ----------------------------------------------------

function encrypt(plain: string): Buffer {
  if (!safeStorage.isEncryptionAvailable()) {
    // Fallback: still store, but as UTF-8 (best effort; main process only).
    return Buffer.from(plain, 'utf8')
  }
  return safeStorage.encryptString(plain)
}

export function decrypt(buf: Buffer | null | undefined): string {
  if (!buf) return ''
  try {
    if (safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(buf)
  } catch {
    // fall through
  }
  return Buffer.from(buf).toString('utf8')
}

// -- Settings --------------------------------------------------------------

export function getSettings(): AppSettings {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>
  const out: AppSettings = { ...DEFAULT_SETTINGS }
  for (const row of rows) {
    try {
      ;(out as any)[row.key] = JSON.parse(row.value)
    } catch {
      /* ignore */
    }
  }
  return out
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const stmt = getDb().prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
  const tx = getDb().transaction((p: Partial<AppSettings>) => {
    for (const [k, v] of Object.entries(p)) stmt.run(k, JSON.stringify(v))
  })
  tx(patch)
  return getSettings()
}

// -- Credentials -----------------------------------------------------------

function rowToCredential(r: any): Credential {
  return {
    id: r.id,
    name: r.name,
    username: r.username,
    authType: r.auth_type,
    isDefault: !!r.is_default,
    createdAt: r.created_at,
    hasSecret: !!r.secret_encrypted
  }
}

export function listCredentials(): Credential[] {
  const rows = getDb().prepare('SELECT * FROM credentials ORDER BY is_default DESC, created_at ASC').all()
  return rows.map(rowToCredential)
}

export function getCredentialSecret(id: string): { username: string; authType: string; secret: string; passphrase: string } | null {
  const r = getDb().prepare('SELECT * FROM credentials WHERE id = ?').get(id) as any
  if (!r) return null
  return {
    username: r.username,
    authType: r.auth_type,
    secret: decrypt(r.secret_encrypted),
    passphrase: decrypt(r.passphrase_encrypted)
  }
}

export function getDefaultCredential(): Credential | null {
  const r = getDb().prepare('SELECT * FROM credentials WHERE is_default = 1 LIMIT 1').get() as any
  return r ? rowToCredential(r) : null
}

export function saveCredential(input: CredentialInput): Credential {
  const id = input.id ?? nanoid()
  const existing = input.id
    ? (getDb().prepare('SELECT * FROM credentials WHERE id = ?').get(input.id) as any)
    : null
  const secretBuf = input.secret ? encrypt(input.secret) : existing?.secret_encrypted
  const passBuf = input.passphrase ? encrypt(input.passphrase) : existing?.passphrase_encrypted ?? null
  const isDefault = input.isDefault ? 1 : existing?.is_default ?? 0
  if (isDefault) getDb().prepare('UPDATE credentials SET is_default = 0').run()
  if (existing) {
    getDb()
      .prepare(
        'UPDATE credentials SET name = ?, username = ?, auth_type = ?, secret_encrypted = ?, passphrase_encrypted = ?, is_default = ? WHERE id = ?'
      )
      .run(input.name, input.username, input.authType, secretBuf, passBuf, isDefault, id)
  } else {
    getDb()
      .prepare(
        'INSERT INTO credentials (id, name, username, auth_type, secret_encrypted, passphrase_encrypted, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(id, input.name, input.username, input.authType, secretBuf, passBuf, isDefault, Date.now())
  }
  return rowToCredential(getDb().prepare('SELECT * FROM credentials WHERE id = ?').get(id))
}

export function deleteCredential(id: string): void {
  getDb().prepare('DELETE FROM credentials WHERE id = ?').run(id)
}

export function setDefaultCredential(id: string): void {
  const tx = getDb().transaction((cid: string) => {
    getDb().prepare('UPDATE credentials SET is_default = 0').run()
    getDb().prepare('UPDATE credentials SET is_default = 1 WHERE id = ?').run(cid)
  })
  tx(id)
}

// -- Servers ---------------------------------------------------------------

function rowToServer(r: any): Server {
  return {
    id: r.id,
    name: r.name,
    host: r.host,
    port: r.port,
    credentialId: r.credential_id,
    color: r.color,
    icon: r.icon,
    tags: safeJson(r.tags, [] as string[]),
    notes: r.notes,
    sortOrder: r.sort_order,
    hostKeySha256: r.host_key_sha256,
    createdAt: r.created_at
  }
}

export function listServers(): Server[] {
  return (getDb().prepare('SELECT * FROM servers ORDER BY sort_order, created_at').all() as any[]).map(rowToServer)
}

export function getServer(id: string): Server | null {
  const r = getDb().prepare('SELECT * FROM servers WHERE id = ?').get(id) as any
  return r ? rowToServer(r) : null
}

export function saveServer(input: ServerInput): Server {
  const id = input.id ?? nanoid()
  const existing = input.id ? (getDb().prepare('SELECT * FROM servers WHERE id = ?').get(input.id) as any) : null
  const port = input.port ?? existing?.port ?? 22
  const credId = input.credentialId === undefined ? existing?.credential_id ?? null : input.credentialId
  const color = input.color ?? existing?.color ?? '#6366f1'
  const icon = input.icon ?? existing?.icon ?? 'server'
  const tags = JSON.stringify(input.tags ?? safeJson(existing?.tags, []))
  const notes = input.notes ?? existing?.notes ?? ''
  if (existing) {
    getDb()
      .prepare(
        'UPDATE servers SET name = ?, host = ?, port = ?, credential_id = ?, color = ?, icon = ?, tags = ?, notes = ? WHERE id = ?'
      )
      .run(input.name, input.host, port, credId, color, icon, tags, notes, id)
  } else {
    const sortRow = getDb().prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 as s FROM servers').get() as { s: number }
    getDb()
      .prepare(
        'INSERT INTO servers (id, name, host, port, credential_id, color, icon, tags, notes, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(id, input.name, input.host, port, credId, color, icon, tags, notes, sortRow.s, Date.now())
  }
  return rowToServer(getDb().prepare('SELECT * FROM servers WHERE id = ?').get(id))
}

export function deleteServer(id: string): void {
  getDb().prepare('DELETE FROM servers WHERE id = ?').run(id)
}

export function pinHostKey(serverId: string, sha256: string): void {
  getDb().prepare('UPDATE servers SET host_key_sha256 = ? WHERE id = ?').run(sha256, serverId)
}

// -- Snapshots -------------------------------------------------------------

export function saveSnapshot(snap: ServerSnapshot): void {
  getDb()
    .prepare(
      `INSERT INTO server_snapshots (
        server_id, collected_at, online, error, os_name, os_version, os_pretty, kernel,
        hostname, uptime_since, cpu_cores, load_1, load_5, load_15,
        mem_total, mem_used, disk_total, disk_used, reboot_required,
        apt_upgradable, apt_security, apt_list, docker_version, raw_json
      ) VALUES (
        @serverId, @collectedAt, @online, @error, @osName, @osVersion, @osPretty, @kernel,
        @hostname, @uptimeSince, @cpuCores, @load1, @load5, @load15,
        @memTotal, @memUsed, @diskTotal, @diskUsed, @rebootRequired,
        @aptUpgradable, @aptSecurity, @aptList, @dockerVersion, @rawJson
      ) ON CONFLICT(server_id) DO UPDATE SET
        collected_at = excluded.collected_at,
        online = excluded.online,
        error = excluded.error,
        os_name = excluded.os_name,
        os_version = excluded.os_version,
        os_pretty = excluded.os_pretty,
        kernel = excluded.kernel,
        hostname = excluded.hostname,
        uptime_since = excluded.uptime_since,
        cpu_cores = excluded.cpu_cores,
        load_1 = excluded.load_1,
        load_5 = excluded.load_5,
        load_15 = excluded.load_15,
        mem_total = excluded.mem_total,
        mem_used = excluded.mem_used,
        disk_total = excluded.disk_total,
        disk_used = excluded.disk_used,
        reboot_required = excluded.reboot_required,
        apt_upgradable = excluded.apt_upgradable,
        apt_security = excluded.apt_security,
        apt_list = excluded.apt_list,
        docker_version = excluded.docker_version,
        raw_json = excluded.raw_json
      `
    )
    .run({
      serverId: snap.serverId,
      collectedAt: snap.collectedAt,
      online: snap.online ? 1 : 0,
      error: snap.error ?? null,
      osName: snap.osName ?? null,
      osVersion: snap.osVersion ?? null,
      osPretty: snap.osPretty ?? null,
      kernel: snap.kernel ?? null,
      hostname: snap.hostname ?? null,
      uptimeSince: snap.uptimeSince ?? null,
      cpuCores: snap.cpuCores ?? null,
      load1: snap.load1 ?? null,
      load5: snap.load5 ?? null,
      load15: snap.load15 ?? null,
      memTotal: snap.memTotal ?? null,
      memUsed: snap.memUsed ?? null,
      diskTotal: snap.diskTotal ?? null,
      diskUsed: snap.diskUsed ?? null,
      rebootRequired: snap.rebootRequired ? 1 : 0,
      aptUpgradable: snap.aptUpgradable ?? null,
      aptSecurity: snap.aptSecurity ?? null,
      aptList: JSON.stringify(snap.aptList ?? []),
      dockerVersion: snap.dockerVersion ?? null,
      rawJson: JSON.stringify({
        composeProjects: snap.composeProjects ?? [],
        standaloneContainers: snap.standaloneContainers ?? []
      })
    })
}

function rowToSnapshot(r: any): ServerSnapshot {
  const raw = safeJson(r.raw_json, {} as any)
  return {
    serverId: r.server_id,
    collectedAt: r.collected_at,
    online: !!r.online,
    error: r.error ?? undefined,
    osName: r.os_name ?? undefined,
    osVersion: r.os_version ?? undefined,
    osPretty: r.os_pretty ?? undefined,
    kernel: r.kernel ?? undefined,
    hostname: r.hostname ?? undefined,
    uptimeSince: r.uptime_since ?? undefined,
    cpuCores: r.cpu_cores ?? undefined,
    load1: r.load_1 ?? undefined,
    load5: r.load_5 ?? undefined,
    load15: r.load_15 ?? undefined,
    memTotal: r.mem_total ?? undefined,
    memUsed: r.mem_used ?? undefined,
    diskTotal: r.disk_total ?? undefined,
    diskUsed: r.disk_used ?? undefined,
    rebootRequired: !!r.reboot_required,
    aptUpgradable: r.apt_upgradable ?? undefined,
    aptSecurity: r.apt_security ?? undefined,
    aptList: safeJson(r.apt_list, []),
    dockerVersion: r.docker_version ?? undefined,
    composeProjects: raw.composeProjects ?? [],
    standaloneContainers: raw.standaloneContainers ?? []
  }
}

export function getSnapshot(serverId: string): ServerSnapshot | null {
  const r = getDb().prepare('SELECT * FROM server_snapshots WHERE server_id = ?').get(serverId) as any
  return r ? rowToSnapshot(r) : null
}

export function listSnapshots(): ServerSnapshot[] {
  return (getDb().prepare('SELECT * FROM server_snapshots').all() as any[]).map(rowToSnapshot)
}

// -- Jobs ------------------------------------------------------------------

export function createJob(input: { serverId: string; type: JobType; target?: string }): Job {
  const id = nanoid()
  getDb()
    .prepare(
      'INSERT INTO jobs (id, server_id, type, target, status, started_at, log) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(id, input.serverId, input.type, input.target ?? '', 'queued' as JobStatus, null, '')
  return getJob(id)!
}

export function appendJobLog(id: string, chunk: string): void {
  getDb().prepare('UPDATE jobs SET log = log || ? WHERE id = ?').run(chunk, id)
}

export function updateJobStatus(
  id: string,
  status: JobStatus,
  opts: { exitCode?: number | null; startedAt?: number; finishedAt?: number } = {}
): void {
  const sets: string[] = ['status = ?']
  const vals: any[] = [status]
  if (opts.exitCode !== undefined) {
    sets.push('exit_code = ?')
    vals.push(opts.exitCode)
  }
  if (opts.startedAt !== undefined) {
    sets.push('started_at = ?')
    vals.push(opts.startedAt)
  }
  if (opts.finishedAt !== undefined) {
    sets.push('finished_at = ?')
    vals.push(opts.finishedAt)
  }
  vals.push(id)
  getDb().prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
}

export function getJob(id: string): Job | null {
  const r = getDb().prepare('SELECT * FROM jobs WHERE id = ?').get(id) as any
  return r
    ? {
        id: r.id,
        serverId: r.server_id,
        type: r.type,
        target: r.target,
        status: r.status,
        startedAt: r.started_at,
        finishedAt: r.finished_at,
        exitCode: r.exit_code,
        log: r.log
      }
    : null
}

export function listJobs(serverId?: string): Job[] {
  const rows = serverId
    ? getDb().prepare('SELECT * FROM jobs WHERE server_id = ? ORDER BY started_at DESC NULLS LAST, id DESC LIMIT 200').all(serverId)
    : getDb().prepare('SELECT * FROM jobs ORDER BY started_at DESC NULLS LAST, id DESC LIMIT 200').all()
  return (rows as any[]).map((r) => ({
    id: r.id,
    serverId: r.server_id,
    type: r.type,
    target: r.target,
    status: r.status,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    exitCode: r.exit_code,
    log: r.log
  }))
}

// -- Image check cache -----------------------------------------------------

export interface ImageCheckRow {
  imageRef: string
  localDigest: string | null
  remoteDigest: string | null
  updateAvailable: boolean
  checkedAt: number
  error: string | null
}

export function getImageCheck(ref: string): ImageCheckRow | null {
  const r = getDb().prepare('SELECT * FROM image_checks WHERE image_ref = ?').get(ref) as any
  return r
    ? {
        imageRef: r.image_ref,
        localDigest: r.local_digest,
        remoteDigest: r.remote_digest,
        updateAvailable: !!r.update_available,
        checkedAt: r.checked_at,
        error: r.error
      }
    : null
}

export function saveImageCheck(row: ImageCheckRow): void {
  getDb()
    .prepare(
      `INSERT INTO image_checks (image_ref, local_digest, remote_digest, update_available, checked_at, error)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(image_ref) DO UPDATE SET
         local_digest = excluded.local_digest,
         remote_digest = excluded.remote_digest,
         update_available = excluded.update_available,
         checked_at = excluded.checked_at,
         error = excluded.error`
    )
    .run(
      row.imageRef,
      row.localDigest,
      row.remoteDigest,
      row.updateAvailable ? 1 : 0,
      row.checkedAt,
      row.error
    )
}

// -- Known hosts -----------------------------------------------------------

export function recordKnownHost(host: string, keyType: string, sha256: string): 'new' | 'match' | 'mismatch' {
  const existing = getDb().prepare('SELECT * FROM known_hosts WHERE host = ?').get(host) as any
  if (!existing) {
    getDb()
      .prepare('INSERT INTO known_hosts (host, key_type, key_sha256, seen_at) VALUES (?, ?, ?, ?)')
      .run(host, keyType, sha256, Date.now())
    return 'new'
  }
  if (existing.key_sha256 !== sha256) return 'mismatch'
  getDb().prepare('UPDATE known_hosts SET seen_at = ? WHERE host = ?').run(Date.now(), host)
  return 'match'
}

// -- Utils -----------------------------------------------------------------

function safeJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}
