import net from 'node:net'
import dns from 'node:dns/promises'
import type { ScanResult } from '@shared/types'

const WEB_PORTS = [80, 443, 8080, 8443, 3000, 5000, 7878, 8096, 8123, 9000, 9090, 9443, 32400]
const SSH_PORT = 22

export type ScanEvent =
  | { kind: 'progress'; done: number; total: number }
  | { kind: 'found'; result: ScanResult }
  | { kind: 'done'; results: ScanResult[] }

function probePort(host: string, port: number, timeoutMs: number): Promise<{ open: boolean; banner?: string }> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false
    let banner = ''
    const end = (open: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve({ open, banner: banner || undefined })
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => {
      if (port !== SSH_PORT) return end(true)
      // For SSH, read the banner briefly.
      const bannerTimer = setTimeout(() => end(true), 500)
      socket.on('data', (d) => {
        banner += d.toString('utf8')
        if (banner.includes('\n')) {
          clearTimeout(bannerTimer)
          end(true)
        }
      })
    })
    socket.once('timeout', () => end(false))
    socket.once('error', () => end(false))
    socket.connect(port, host)
  })
}

function parseCidr(cidr: string): string[] {
  const m = cidr.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/)
  if (!m) throw new Error(`Invalid CIDR: ${cidr}`)
  const base = m[1].split('.').map(Number)
  const bits = Number(m[2])
  if (bits < 16 || bits > 32) throw new Error('CIDR must be /16 - /32')
  const baseInt = (base[0] << 24) | (base[1] << 16) | (base[2] << 8) | base[3]
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
  const network = (baseInt & mask) >>> 0
  const broadcast = (network | (~mask >>> 0)) >>> 0
  const hosts: string[] = []
  const start = bits === 32 ? network : network + 1
  const end = bits === 32 ? network : broadcast - 1
  for (let i = start; i <= end; i++) {
    hosts.push(`${(i >>> 24) & 0xff}.${(i >>> 16) & 0xff}.${(i >>> 8) & 0xff}.${i & 0xff}`)
  }
  return hosts
}

async function runWithConcurrency<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length) as R[]
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return results
}

let cancelFlag = false

export function cancelScan(): void {
  cancelFlag = true
}

export async function scanSubnet(subnet: string, timeoutMs: number, onEvent: (e: ScanEvent) => void): Promise<ScanResult[]> {
  cancelFlag = false
  const hosts = parseCidr(subnet)
  const total = hosts.length
  const results: ScanResult[] = []
  let done = 0

  await runWithConcurrency(hosts, 64, async (host) => {
    if (cancelFlag) {
      done++
      return
    }
    const ssh = await probePort(host, SSH_PORT, timeoutMs)
    if (ssh.open) {
      let reverse: string | undefined
      try {
        const names = await dns.reverse(host)
        reverse = names[0]
      } catch {
        /* no reverse DNS */
      }
      const openPorts: number[] = [SSH_PORT]
      // Probe web ports in parallel with a tighter timeout.
      await Promise.all(
        WEB_PORTS.map(async (p) => {
          const r = await probePort(host, p, Math.min(timeoutMs, 300))
          if (r.open) openPorts.push(p)
        })
      )
      // Keep only the first line of the SSH banner - after \r\n comes the
      // binary key-exchange init which must not be shown to the user.
      const bannerLine = ssh.banner?.split(/\r?\n/)[0]?.trim()
      const result: ScanResult = {
        host,
        port: SSH_PORT,
        sshBanner: bannerLine,
        reverseHostname: reverse,
        openPorts: openPorts.sort((a, b) => a - b)
      }
      results.push(result)
      onEvent({ kind: 'found', result })
    }
    done++
    if (done % 8 === 0 || done === total) onEvent({ kind: 'progress', done, total })
  })

  onEvent({ kind: 'done', results })
  return results
}
