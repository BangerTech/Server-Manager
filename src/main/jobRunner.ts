import { BrowserWindow } from 'electron'
import type { Job, JobLogChunk, JobType } from '@shared/types'
import { IPC_EVENTS } from '@shared/types'
import { execStream } from './ssh/pool'
import { appendJobLog, createJob, getServer, updateJobStatus } from './db'

interface RunningJob {
  job: Job
  cancel: () => void
}

const running = new Map<string, RunningJob>()
const queue: Array<{ serverId: string; type: JobType; target?: string; jobId: string }> = []
let activeCount = 0
const MAX_PARALLEL = 3

function emit(win: BrowserWindow | null, chunk: JobLogChunk): void {
  win?.webContents.send(IPC_EVENTS.jobLog, chunk)
}

function buildCommand(type: JobType, target: string): { cmd: string; title: string } {
  switch (type) {
    case 'apt-update':
      return { cmd: `DEBIAN_FRONTEND=noninteractive apt-get update`, title: 'apt-get update' }
    case 'apt-upgrade':
      return {
        cmd: `DEBIAN_FRONTEND=noninteractive apt-get update && DEBIAN_FRONTEND=noninteractive apt-get -y -o Dpkg::Options::="--force-confold" upgrade && DEBIAN_FRONTEND=noninteractive apt-get -y autoremove && DEBIAN_FRONTEND=noninteractive apt-get -y autoclean`,
        title: 'apt upgrade (+ autoremove, autoclean)'
      }
    case 'apt-full-upgrade':
      return {
        cmd: `DEBIAN_FRONTEND=noninteractive apt-get update && DEBIAN_FRONTEND=noninteractive apt-get -y -o Dpkg::Options::="--force-confold" dist-upgrade && DEBIAN_FRONTEND=noninteractive apt-get -y autoremove && DEBIAN_FRONTEND=noninteractive apt-get -y autoclean`,
        title: 'apt full-upgrade (+ autoremove, autoclean)'
      }
    case 'compose-pull':
      return { cmd: composeCmd(target, 'pull'), title: `compose pull ${target}` }
    case 'compose-up':
      return { cmd: composeCmd(target, 'pull && docker compose up -d'), title: `compose up ${target}` }
    case 'compose-restart':
      return { cmd: composeCmd(target, 'restart'), title: `compose restart ${target}` }
    case 'compose-down':
      return { cmd: composeCmd(target, 'down'), title: `compose down ${target}` }
    case 'image-prune':
      return { cmd: `docker image prune -f`, title: 'docker image prune' }
    case 'container-restart':
      return { cmd: `docker restart ${sh(target)}`, title: `restart ${target}` }
    case 'container-stop':
      return { cmd: `docker stop ${sh(target)}`, title: `stop ${target}` }
    case 'container-start':
      return { cmd: `docker start ${sh(target)}`, title: `start ${target}` }
    case 'reboot':
      return { cmd: `reboot`, title: 'reboot host' }
    default:
      return { cmd: `echo "unknown job type"`, title: 'unknown' }
  }
}

function sh(s: string): string {
  return `'${(s || '').replace(/'/g, `'\\''`)}'`
}

/**
 * Build a `docker compose` command that first resolves the project's working directory
 * from a container label (set by Compose itself) and then runs the sub-command there,
 * so Compose can auto-discover its yml. Falls back with a clear error if the project
 * has no containers (e.g. was never `up`'d on this host).
 */
function composeCmd(project: string, sub: string): string {
  const p = sh(project)
  return [
    `P=${p}`,
    `WD=$(docker ps -aqf "label=com.docker.compose.project=$P" | head -1 | xargs -r docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' 2>/dev/null)`,
    `if [ -z "$WD" ] || [ ! -d "$WD" ]; then echo "compose: could not resolve working_dir for project $P" >&2; exit 2; fi`,
    `cd "$WD"`,
    `docker compose ${sub}`
  ].join(' && ')
}

async function processQueue(getWin: () => BrowserWindow | null): Promise<void> {
  while (queue.length > 0 && activeCount < MAX_PARALLEL) {
    const next = queue.shift()!
    activeCount++
    runOne(next.jobId, next.serverId, next.type, next.target ?? '', getWin).finally(() => {
      activeCount--
      void processQueue(getWin)
    })
  }
}

async function runOne(
  jobId: string,
  serverId: string,
  type: JobType,
  target: string,
  getWin: () => BrowserWindow | null
): Promise<void> {
  const win = getWin()
  const server = getServer(serverId)
  if (!server) {
    updateJobStatus(jobId, 'error', { finishedAt: Date.now(), exitCode: -1 })
    emit(win, { jobId, chunk: 'Server not found\n', done: true, status: 'error', exitCode: -1 })
    return
  }
  const { cmd, title } = buildCommand(type, target)
  const header = `\x1b[1;36m$ ${title}\x1b[0m\n`
  updateJobStatus(jobId, 'running', { startedAt: Date.now() })
  appendJobLog(jobId, header)
  emit(win, { jobId, chunk: header, done: false, status: 'running' })

  try {
    const handle = await execStream(server, cmd, (chunk) => {
      appendJobLog(jobId, chunk)
      emit(win, { jobId, chunk, done: false })
    })
    running.set(jobId, {
      job: { id: jobId, serverId, type, target, status: 'running', startedAt: Date.now(), finishedAt: null, exitCode: null, log: '' },
      cancel: handle.cancel
    })
    const { code } = await handle.done
    const status = code === 0 ? 'success' : 'error'
    updateJobStatus(jobId, status, { finishedAt: Date.now(), exitCode: code })
    const footer = `\n\x1b[${status === 'success' ? '32' : '31'}m[exit ${code}]\x1b[0m\n`
    appendJobLog(jobId, footer)
    emit(win, { jobId, chunk: footer, done: true, status, exitCode: code ?? -1 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    updateJobStatus(jobId, 'error', { finishedAt: Date.now(), exitCode: -1 })
    appendJobLog(jobId, `\n\x1b[31m${msg}\x1b[0m\n`)
    emit(win, { jobId, chunk: `\n${msg}\n`, done: true, status: 'error', exitCode: -1 })
  } finally {
    running.delete(jobId)
  }
}

export function enqueueJob(
  input: { serverId: string; type: JobType; target?: string },
  getWin: () => BrowserWindow | null
): string {
  const job = createJob(input)
  queue.push({ serverId: input.serverId, type: input.type, target: input.target, jobId: job.id })
  void processQueue(getWin)
  return job.id
}

export function enqueueJobs(
  inputs: Array<{ serverId: string; type: JobType; target?: string }>,
  getWin: () => BrowserWindow | null
): string[] {
  return inputs.map((i) => enqueueJob(i, getWin))
}

export function cancelJob(id: string): void {
  const r = running.get(id)
  if (r) {
    r.cancel()
    updateJobStatus(id, 'cancelled', { finishedAt: Date.now(), exitCode: -1 })
  } else {
    // may still be queued
    const idx = queue.findIndex((q) => q.jobId === id)
    if (idx !== -1) {
      queue.splice(idx, 1)
      updateJobStatus(id, 'cancelled', { finishedAt: Date.now(), exitCode: -1 })
    }
  }
}
