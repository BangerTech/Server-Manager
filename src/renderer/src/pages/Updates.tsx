import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Badge, Card, Spinner } from '@/components/ui/primitives'
import { DownloadCloud, Container, Package } from 'lucide-react'
import type { JobType } from '@shared/types'

interface UpdateRow {
  key: string
  serverId: string
  serverName: string
  kind: 'apt' | 'image'
  target: string
  detail: string
  jobType: JobType
  jobTarget?: string
}

export function Updates(): JSX.Element {
  const qc = useQueryClient()
  const { data: servers } = useQuery({ queryKey: ['servers'], queryFn: () => window.api.servers.list() })
  const { data: snapshots } = useQuery({ queryKey: ['snapshots'], queryFn: () => window.api.servers.listSnapshots() })
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const serverById = new Map(servers?.map((s) => [s.id, s]))
  const rows = useMemo<UpdateRow[]>(() => {
    const result: UpdateRow[] = []
    for (const snap of snapshots ?? []) {
      const srv = serverById.get(snap.serverId)
      if (!srv) continue
      if (snap.aptUpgradable && snap.aptUpgradable > 0) {
        result.push({
          key: `apt-${snap.serverId}`,
          serverId: snap.serverId,
          serverName: srv.name,
          kind: 'apt',
          target: `${snap.aptUpgradable} apt packages`,
          detail: snap.aptSecurity ? `${snap.aptSecurity} security` : 'system packages',
          jobType: 'apt-upgrade'
        })
      }
      const projects = snap.composeProjects ?? []
      const seen = new Set<string>()
      for (const p of projects) {
        const updates = p.containers.filter((c) => c.updateAvailable)
        if (updates.length) {
          seen.add(p.name)
          result.push({
            key: `stack-${snap.serverId}-${p.name}`,
            serverId: snap.serverId,
            serverName: srv.name,
            kind: 'image',
            target: p.name,
            detail: updates.map((c) => c.image).join(', '),
            jobType: 'compose-up',
            jobTarget: p.name
          })
        }
      }
    }
    return result
  }, [snapshots, serverById])

  const runMany = useMutation({
    mutationFn: async (items: UpdateRow[]) => {
      return window.api.jobs.runMany(items.map((r) => ({ serverId: r.serverId, type: r.jobType, target: r.jobTarget })))
    },
    onSuccess: () => {
      setSelected(new Set())
      qc.invalidateQueries({ queryKey: ['jobs'] })
    }
  })

  const toggle = (key: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const toggleAll = (): void => {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.key))))
  }

  const selectedRows = rows.filter((r) => selected.has(r.key))

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Updates</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} update{rows.length === 1 ? '' : 's'} available across your servers
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={toggleAll} disabled={rows.length === 0}>
            {selected.size === rows.length && rows.length > 0 ? 'Clear' : 'Select all'}
          </Button>
          <Button onClick={() => runMany.mutate(selectedRows)} disabled={selected.size === 0 || runMany.isPending}>
            {runMany.isPending ? <Spinner /> : <DownloadCloud size={14} />} Update {selected.size || ''}
          </Button>
        </div>
      </header>

      {rows.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">Everything is up to date.</Card>
      ) : (
        <Card className="divide-y divide-border">
          {rows.map((r) => (
            <label key={r.key} className="flex cursor-pointer items-center gap-4 px-4 py-3 hover:bg-accent/30">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={selected.has(r.key)}
                onChange={() => toggle(r.key)}
              />
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-muted-foreground">
                {r.kind === 'apt' ? <Package size={14} /> : <Container size={14} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{r.target}</span>
                  <Badge variant="outline">{r.serverName}</Badge>
                </div>
                <div className="truncate text-xs text-muted-foreground">{r.detail}</div>
              </div>
              <Badge variant={r.kind === 'apt' ? 'warning' : 'info'}>{r.kind}</Badge>
            </label>
          ))}
        </Card>
      )}
    </div>
  )
}
