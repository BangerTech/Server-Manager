import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card, Input, Label, Badge, Progress } from '@/components/ui/primitives'
import { Search, Plus, X } from 'lucide-react'
import { IPC_EVENTS, type ScanResult } from '@shared/types'

interface BannerInfo {
  impl?: string
  version?: string
  osHint?: string
}

function parseBanner(banner: string | undefined): BannerInfo {
  if (!banner) return {}
  // Strip the SSH-2.0- prefix, then split on space: "<impl>_<version> <comment>"
  const m = banner.match(/^SSH-2\.0-([^\s]+)(?:\s+(.*))?$/i)
  if (!m) return {}
  const [impl, version] = m[1].split('_')
  const comment = (m[2] ?? '').trim()
  // OS hints like "Debian-2+deb12u9" -> "Debian 12"
  let osHint: string | undefined
  const deb = /deb(\d+)u\d+/i.exec(comment) || /deb(\d+)u\d+/i.exec(m[1])
  if (deb) osHint = `Debian ${deb[1]}`
  else if (/ubuntu/i.test(comment)) osHint = 'Ubuntu'
  else if (/raspbian/i.test(comment)) osHint = 'Raspbian'
  else if (/alpine/i.test(comment)) osHint = 'Alpine'
  return { impl, version, osHint }
}

// Well-known ports -> friendly service names.
const SERVICE_NAMES: Record<number, string> = {
  22: 'SSH',
  80: 'HTTP',
  443: 'HTTPS',
  3000: 'HTTP',
  5000: 'HTTP',
  7878: 'Radarr',
  8080: 'HTTP',
  8096: 'Jellyfin',
  8123: 'Home Assistant',
  8443: 'HTTPS',
  9000: 'Portainer',
  9090: 'Cockpit',
  9443: 'Portainer',
  32400: 'Plex'
}

export function Scan(): JSX.Element {
  const qc = useQueryClient()
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.api.settings.get() })
  const { data: existing } = useQuery({ queryKey: ['servers'], queryFn: () => window.api.servers.list() })
  const [subnet, setSubnet] = useState('')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [results, setResults] = useState<ScanResult[]>([])
  const [running, setRunning] = useState(false)

  useEffect(() => {
    if (settings && !subnet) setSubnet(settings.subnet)
  }, [settings, subnet])

  useEffect(() => {
    const offs = [
      window.api.events.on(IPC_EVENTS.scanProgress, (p) => {
        const payload = p as { done: number; total: number }
        setProgress({ done: payload.done, total: payload.total })
      }),
      window.api.events.on(IPC_EVENTS.scanFound, (p) => {
        setResults((prev) => [...prev, p as ScanResult])
      }),
      window.api.events.on(IPC_EVENTS.scanDone, () => {
        setRunning(false)
      })
    ]
    return () => offs.forEach((o) => o())
  }, [])

  const start = async (): Promise<void> => {
    setResults([])
    setProgress({ done: 0, total: 0 })
    setRunning(true)
    try {
      await window.api.scan.start(subnet)
    } finally {
      setRunning(false)
    }
  }

  const existingHosts = new Set(existing?.map((s) => s.host))

  const add = async (r: ScanResult): Promise<void> => {
    const name = r.reverseHostname?.split('.')[0] || r.host
    await window.api.servers.save({
      name,
      host: r.host,
      port: r.port
    })
    qc.invalidateQueries({ queryKey: ['servers'] })
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <h1 className="text-2xl font-semibold">Network Scan</h1>
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1 space-y-1">
            <Label>Subnet (CIDR)</Label>
            <Input value={subnet} onChange={(e) => setSubnet(e.target.value)} placeholder="192.168.2.0/24" />
          </div>
          <Button onClick={start} disabled={running || !subnet}>
            <Search size={14} /> {running ? 'Scanning…' : 'Start scan'}
          </Button>
          {running && (
            <Button variant="secondary" onClick={() => window.api.scan.cancel()}>
              <X size={14} /> Cancel
            </Button>
          )}
        </div>
        {progress.total > 0 && (
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-xs text-muted-foreground">
              <span>{progress.done} / {progress.total} hosts probed</span>
              <span>{results.length} found</span>
            </div>
            <Progress value={(progress.done / Math.max(1, progress.total)) * 100} />
          </div>
        )}
      </Card>

      {results.length > 0 && (
        <Card className="divide-y divide-border">
          {results
            .sort((a, b) => a.host.localeCompare(b.host, undefined, { numeric: true }))
            .map((r) => {
              const alreadyAdded = existingHosts.has(r.host)
              const info = parseBanner(r.sshBanner)
              const summaryParts = [
                info.impl && info.version ? `${info.impl} ${info.version}` : info.impl,
                info.osHint
              ].filter(Boolean)
              return (
                <div key={r.host} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{r.host}</span>
                      {r.reverseHostname && <Badge variant="outline">{r.reverseHostname}</Badge>}
                    </div>
                    {summaryParts.length > 0 && (
                      <div className="truncate text-xs text-muted-foreground">{summaryParts.join(' - ')}</div>
                    )}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {r.openPorts.map((p) => (
                        <Badge key={p} variant={p === 22 ? 'outline' : 'info'}>
                          {SERVICE_NAMES[p] ? `${SERVICE_NAMES[p]} :${p}` : `:${p}`}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <Button size="sm" disabled={alreadyAdded} onClick={() => add(r)}>
                    <Plus size={14} /> {alreadyAdded ? 'Added' : 'Add'}
                  </Button>
                </div>
              )
            })}
        </Card>
      )}
    </div>
  )
}
