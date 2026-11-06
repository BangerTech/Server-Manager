import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card, EmptyState, Spinner } from '@/components/ui/primitives'
import { ServerCard } from '@/components/ServerCard'
import { Server as ServerIcon, RefreshCw, DownloadCloud, AlertTriangle, Container, Zap } from 'lucide-react'
import { useUI } from '@/store'
import { timeAgo } from '@/lib/utils'

export function Dashboard(): JSX.Element {
  const qc = useQueryClient()
  const { data: servers } = useQuery({ queryKey: ['servers'], queryFn: () => window.api.servers.list() })
  const { data: snapshots } = useQuery({ queryKey: ['snapshots'], queryFn: () => window.api.servers.listSnapshots() })
  const go = useUI((s) => s.go)

  const refreshAll = useMutation({
    mutationFn: () => window.api.servers.refreshAll(),
    onSettled: () => qc.invalidateQueries({ queryKey: ['snapshots'] })
  })

  const snapById = new Map(snapshots?.map((s) => [s.serverId, s]))
  const online = snapshots?.filter((s) => s.online).length ?? 0
  const total = servers?.length ?? 0
  const aptTotal = snapshots?.reduce((s, x) => s + (x.aptUpgradable ?? 0), 0) ?? 0
  const rebootCount = snapshots?.filter((s) => s.rebootRequired).length ?? 0
  const containerUpdates =
    snapshots?.reduce(
      (s, x) =>
        s +
        (x.standaloneContainers?.filter((c) => c.updateAvailable).length ?? 0) +
        (x.composeProjects?.reduce((a, p) => a + p.containers.filter((c) => c.updateAvailable).length, 0) ?? 0),
      0
    ) ?? 0
  const lastRefresh = snapshots?.length ? Math.max(...snapshots.map((s) => s.collectedAt)) : null

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Last refresh {timeAgo(lastRefresh)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => go({ name: 'scan' })}>
            <ServerIcon size={14} /> Scan network
          </Button>
          <Button onClick={() => refreshAll.mutate()} disabled={refreshAll.isPending}>
            {refreshAll.isPending ? <Spinner /> : <RefreshCw size={14} />}
            Refresh all
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard icon={<Zap className="text-primary" />} label="Online" value={`${online} / ${total}`} />
        <StatCard icon={<DownloadCloud className="text-[hsl(var(--info))]" />} label="apt updates" value={String(aptTotal)} />
        <StatCard icon={<Container className="text-[hsl(var(--info))]" />} label="Container updates" value={String(containerUpdates)} />
        <StatCard icon={<AlertTriangle className="text-[hsl(var(--warning))]" />} label="Reboot needed" value={String(rebootCount)} />
      </div>

      {servers && servers.length === 0 ? (
        <EmptyState
          icon={<ServerIcon size={32} />}
          title="No servers yet"
          description="Scan your network or add a server manually to get started."
          action={
            <div className="flex gap-2">
              <Button onClick={() => go({ name: 'scan' })}>Scan network</Button>
              <Button variant="secondary" onClick={() => go({ name: 'servers' })}>
                Add manually
              </Button>
            </div>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {servers?.map((s) => (
            <ServerCard key={s.id} server={s} snapshot={snapById.get(s.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }): JSX.Element {
  return (
    <Card className="flex items-center gap-4 p-4">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent">{icon}</div>
      <div>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-xl font-semibold">{value}</div>
      </div>
    </Card>
  )
}
