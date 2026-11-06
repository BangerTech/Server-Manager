import type { ComposeProject, ContainerInfo, Server, ServerSnapshot } from '@shared/types'
import { exec } from './ssh/pool'
import { getServer, listServers, saveSnapshot } from './db'

/**
 * A single bash snippet that collects all of the data we need and prints it with
 * `===SECTION===` delimiters so we can parse it cheaply. Running it in one SSH
 * session keeps overhead to one handshake per refresh.
 */
const COLLECTOR_SCRIPT = `set +e
export LC_ALL=C LANG=C
echo '===OS==='
cat /etc/os-release 2>/dev/null
echo '===KERNEL==='
uname -r 2>/dev/null
echo '===HOSTNAME==='
hostname 2>/dev/null
echo '===UPTIME==='
uptime -s 2>/dev/null
echo '===CPU==='
nproc 2>/dev/null
echo '===LOAD==='
cat /proc/loadavg 2>/dev/null
echo '===MEM==='
awk '/^MemTotal:/ {t=$2*1024} /^MemAvailable:/ {a=$2*1024} END {if (t) print t" "(t-a)}' /proc/meminfo 2>/dev/null
echo '===DISK==='
df -B1 --output=size,used / 2>/dev/null | tail -1
echo '===REBOOT==='
if [ -f /var/run/reboot-required ]; then echo yes; else echo no; fi
echo '===APT==='
LC_ALL=C apt list --upgradable 2>/dev/null | tail -n +2
echo '===DOCKER_VER==='
docker version --format '{{.Server.Version}}' 2>/dev/null
echo '===COMPOSE_LS==='
docker compose ls --all --format json 2>/dev/null
echo '===PS==='
docker ps -a --no-trunc --format '{{json .}}' 2>/dev/null
echo '===IMAGES==='
docker image ls --digests --no-trunc --format '{{json .}}' 2>/dev/null
echo '===END==='
`

function parseSections(stdout: string): Record<string, string> {
  const sections: Record<string, string> = {}
  const lines = stdout.split(/\r?\n/)
  let current: string | null = null
  const buffer: string[] = []
  for (const line of lines) {
    const m = line.match(/^===([A-Z_]+)===$/)
    if (m) {
      if (current) sections[current] = buffer.join('\n').trim()
      current = m[1]
      buffer.length = 0
    } else if (current) {
      buffer.push(line)
    }
  }
  if (current) sections[current] = buffer.join('\n').trim()
  return sections
}

function parseOsRelease(raw: string): { name?: string; version?: string; pretty?: string } {
  const out: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, '')
  }
  return { name: out.ID, version: out.VERSION_ID, pretty: out.PRETTY_NAME }
}

function parseApt(raw: string): Array<{ name: string; from: string; to: string; security: boolean }> {
  const result: Array<{ name: string; from: string; to: string; security: boolean }> = []
  for (const line of raw.split('\n')) {
    // Example: nginx/stable 1.24.0-1 amd64 [upgradable from: 1.22.0-1]
    const m = line.match(/^([^\s/]+)\/(\S+)\s+(\S+)\s+\S+\s+\[upgradable from:\s+(\S+)\]/)
    if (m) {
      result.push({
        name: m[1],
        to: m[3],
        from: m[4],
        security: /security/i.test(m[2])
      })
    }
  }
  return result
}

interface DockerPsRow {
  ID: string
  Names: string
  Image: string
  State: string
  Status: string
  Ports: string
  Labels: string
  CreatedAt: string
}

interface DockerImageRow {
  Repository: string
  Tag: string
  Digest: string
  ID: string
}

function parseJsonLines<T>(raw: string): T[] {
  const out: T[] = []
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      out.push(JSON.parse(t) as T)
    } catch {
      /* skip */
    }
  }
  return out
}

function parsePorts(raw: string): ContainerInfo['ports'] {
  const out: ContainerInfo['ports'] = []
  if (!raw) return out
  for (const part of raw.split(',').map((s) => s.trim())) {
    // Examples:
    //  0.0.0.0:8080->80/tcp
    //  :::443->443/tcp
    //  80/tcp
    const m = part.match(/(?:([0-9.:a-fA-F]+):(\d+)->)?(\d+)\/(tcp|udp)/)
    if (m) {
      out.push({
        host: m[2] ? Number(m[2]) : undefined,
        container: Number(m[3]),
        protocol: m[4]
      })
    }
  }
  return out
}

function buildWebUrls(host: string, ports: ContainerInfo['ports']): string[] {
  const urls: string[] = []
  for (const p of ports) {
    if (!p.host) continue
    if ([80, 8080, 3000, 5000, 8096, 8123, 9000, 9090, 32400, 7878].includes(p.host)) {
      urls.push(`http://${host}:${p.host}`)
    } else if ([443, 8443, 9443].includes(p.host)) {
      urls.push(`https://${host}:${p.host}`)
    }
  }
  return urls
}

export async function collectServer(serverOrId: Server | string): Promise<ServerSnapshot> {
  const server = typeof serverOrId === 'string' ? getServer(serverOrId) : serverOrId
  if (!server) throw new Error('Server not found')

  const started = Date.now()
  try {
    const res = await exec(server, COLLECTOR_SCRIPT, { timeoutMs: 25000 })
    const s = parseSections(res.stdout)
    const osInfo = parseOsRelease(s.OS ?? '')
    const memParts = (s.MEM ?? '').split(/\s+/).map(Number)
    const diskParts = (s.DISK ?? '').split(/\s+/).map(Number)
    const loadParts = (s.LOAD ?? '').split(/\s+/)
    const apt = parseApt(s.APT ?? '')
    const dockerVersion = s.DOCKER_VER || undefined

    const psRows = parseJsonLines<DockerPsRow>(s.PS ?? '')
    const imageRows = parseJsonLines<DockerImageRow>(s.IMAGES ?? '')
    // Map Repository:Tag -> Digest (RepoDigest form: repo@sha256:...)
    const digestByRef = new Map<string, string>()
    for (const img of imageRows) {
      if (img.Digest && img.Digest !== '<none>' && img.Repository && img.Tag && img.Repository !== '<none>') {
        digestByRef.set(`${img.Repository}:${img.Tag}`, img.Digest)
      }
    }

    const containers: ContainerInfo[] = psRows.map((row) => {
      const labels = Object.fromEntries(
        (row.Labels || '').split(',').map((l) => {
          const i = l.indexOf('=')
          return i === -1 ? [l, ''] : [l.slice(0, i), l.slice(i + 1)]
        })
      )
      const projectName = labels['com.docker.compose.project'] || undefined
      const ports = parsePorts(row.Ports)
      return {
        id: row.ID,
        name: row.Names,
        image: row.Image,
        imageDigest: digestByRef.get(row.Image) ?? null,
        state: row.State,
        status: row.Status,
        ports,
        projectName,
        webUrls: buildWebUrls(server.host, ports)
      }
    })

    // Parse `docker compose ls` output
    let composeLs: Array<{ Name: string; Status: string; ConfigFiles?: string }> = []
    try {
      const parsed = JSON.parse(s.COMPOSE_LS || '[]')
      if (Array.isArray(parsed)) composeLs = parsed
    } catch {
      composeLs = parseJsonLines(s.COMPOSE_LS ?? '')
    }
    const projectMap = new Map<string, ComposeProject>()
    for (const c of composeLs) {
      projectMap.set(c.Name, {
        name: c.Name,
        status: c.Status,
        workingDir: '',
        configFiles: c.ConfigFiles ? c.ConfigFiles.split(',') : [],
        containers: []
      })
    }
    const standalone: ContainerInfo[] = []
    for (const c of containers) {
      if (c.projectName && projectMap.has(c.projectName)) projectMap.get(c.projectName)!.containers.push(c)
      else if (c.projectName) {
        projectMap.set(c.projectName, {
          name: c.projectName,
          status: '',
          workingDir: '',
          configFiles: [],
          containers: [c]
        })
      } else {
        standalone.push(c)
      }
    }

    const snap: ServerSnapshot = {
      serverId: server.id,
      collectedAt: started,
      online: true,
      osName: osInfo.name,
      osVersion: osInfo.version,
      osPretty: osInfo.pretty,
      kernel: s.KERNEL || undefined,
      hostname: s.HOSTNAME || undefined,
      uptimeSince: s.UPTIME || undefined,
      cpuCores: Number(s.CPU) || undefined,
      load1: Number(loadParts[0]) || undefined,
      load5: Number(loadParts[1]) || undefined,
      load15: Number(loadParts[2]) || undefined,
      memTotal: memParts[0] || undefined,
      memUsed: memParts[1] || undefined,
      diskTotal: diskParts[0] || undefined,
      diskUsed: diskParts[1] || undefined,
      rebootRequired: (s.REBOOT || '').trim() === 'yes',
      aptUpgradable: apt.length,
      aptSecurity: apt.filter((a) => a.security).length,
      aptList: apt,
      dockerVersion,
      composeProjects: Array.from(projectMap.values()),
      standaloneContainers: standalone
    }
    saveSnapshot(snap)
    return snap
  } catch (err) {
    const snap: ServerSnapshot = {
      serverId: server.id,
      collectedAt: started,
      online: false,
      error: err instanceof Error ? err.message : String(err)
    }
    saveSnapshot(snap)
    return snap
  }
}

export async function collectAllServers(onProgress?: (id: string) => void): Promise<void> {
  const servers = listServers()
  const limit = 8
  let next = 0
  const workers = Array.from({ length: Math.min(limit, servers.length) }, async () => {
    while (next < servers.length) {
      const s = servers[next++]
      try {
        await collectServer(s)
      } catch {
        /* collectServer already saves failure */
      }
      onProgress?.(s.id)
    }
  })
  await Promise.all(workers)
}
