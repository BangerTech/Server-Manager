import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  RefreshCw,
  Terminal as TerminalIcon,
  Container as ContainerIcon,
  Package,
  Activity,
  History,
  Play,
  StopCircle,
  RotateCw,
  Power,
  DownloadCloud,
  ExternalLink,
  Trash2,
  ChevronDown,
  ChevronRight,
  Cpu,
  MemoryStick,
  HardDrive,
  Clock,
  TerminalSquare
} from 'lucide-react'
import { useUI } from '@/store'
import { Button } from '@/components/ui/button'
import { Badge, Card, Modal, Progress, Spinner, Tabs } from '@/components/ui/primitives'
import { IPC_EVENTS } from '@shared/types'
import { Terminal } from '@/components/Terminal'
import { JobLog } from '@/components/JobLog'
import { formatBytes, formatUptime, percent, timeAgo } from '@/lib/utils'
import type { ContainerInfo, JobType, Server, ServerSnapshot } from '@shared/types'

type TabId = 'overview' | 'stacks' | 'packages' | 'terminal' | 'history'

export function ServerDetail({ serverId }: { serverId: string }): JSX.Element {
  const [tab, setTab] = useState<TabId>('overview')
  const go = useUI((s) => s.go)
  const qc = useQueryClient()

  const { data: server } = useQuery({
    queryKey: ['server', serverId],
    queryFn: async () => (await window.api.servers.list()).find((s) => s.id === serverId) ?? null
  })
  const { data: snapshot } = useQuery({
    queryKey: ['snapshot', serverId],
    queryFn: () => window.api.servers.getSnapshot(serverId)
  })
  const { data: jobs } = useQuery({
    queryKey: ['jobs', serverId],
    queryFn: () => window.api.jobs.list(serverId),
    refetchInterval: 3000
  })

  const refresh = useMutation({
    mutationFn: () => window.api.servers.refresh(serverId),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['snapshot', serverId] })
      qc.invalidateQueries({ queryKey: ['snapshots'] })
    }
  })

  if (!server) return <div className="text-muted-foreground">Loading…</div>

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => go({ name: 'dashboard' })}>
            <ArrowLeft size={16} />
          </Button>
          <div
            className="flex h-10 w-10 items-center justify-center rounded-lg text-white"
            style={{ background: server.color }}
          >
            {(server.name || server.host).slice(0, 2).toUpperCase()}
          </div>
          <div>
            <h1 className="text-xl font-semibold">{server.name}</h1>
            <p className="text-xs text-muted-foreground">
              {server.host}:{server.port} • snapshot {timeAgo(snapshot?.collectedAt ?? null)}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
            {refresh.isPending ? <Spinner /> : <RefreshCw size={14} />} Refresh
          </Button>
        </div>
      </div>

      <Tabs
        active={tab}
        onChange={(id) => setTab(id as TabId)}
        items={[
          { id: 'overview', label: 'Overview', icon: <Activity size={14} /> },
          { id: 'stacks', label: 'Docker', icon: <ContainerIcon size={14} /> },
          { id: 'packages', label: 'Packages', icon: <Package size={14} /> },
          { id: 'terminal', label: 'Terminal', icon: <TerminalIcon size={14} /> },
          { id: 'history', label: 'History', icon: <History size={14} /> }
        ]}
      />

      {tab === 'overview' && <OverviewTab snapshot={snapshot ?? null} server={server} />}
      {tab === 'stacks' && <StacksTab serverId={serverId} snapshot={snapshot ?? null} />}
      {tab === 'packages' && <PackagesTab serverId={serverId} snapshot={snapshot ?? null} />}
      {tab === 'terminal' && (
        <div className="h-[calc(100vh-240px)]">
          <Terminal serverId={serverId} />
        </div>
      )}
      {tab === 'history' && <HistoryTab jobs={jobs ?? []} />}
    </div>
  )
}

function OverviewTab({ snapshot, server }: { snapshot: ServerSnapshot | null; server: Server }): JSX.Element {
  if (!snapshot) return <div className="text-muted-foreground">No snapshot yet. Click Refresh.</div>
  const memPct = percent(snapshot.memUsed, snapshot.memTotal)
  const diskPct = percent(snapshot.diskUsed, snapshot.diskTotal)
  const cpuPct =
    snapshot.cpuCores && snapshot.load1 != null
      ? Math.min(100, Math.round((snapshot.load1 / snapshot.cpuCores) * 100))
      : 0
  const containerCount =
    (snapshot.standaloneContainers?.length ?? 0) +
    (snapshot.composeProjects?.reduce((s, p) => s + p.containers.length, 0) ?? 0)
  const containerRunning =
    (snapshot.standaloneContainers?.filter((c) => c.state === 'running').length ?? 0) +
    (snapshot.composeProjects?.reduce((s, p) => s + p.containers.filter((c) => c.state === 'running').length, 0) ?? 0)

  return (
    <div className="space-y-4">
      {/* Resource tiles */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ResourceTile
          icon={<Cpu size={16} />}
          label="CPU"
          value={`${cpuPct}%`}
          sub={snapshot.cpuCores ? `${snapshot.cpuCores} cores - load ${snapshot.load1?.toFixed(2) ?? '-'}` : undefined}
          progress={cpuPct}
        />
        <ResourceTile
          icon={<MemoryStick size={16} />}
          label="RAM"
          value={snapshot.memTotal ? `${formatBytes(snapshot.memUsed)} / ${formatBytes(snapshot.memTotal)}` : '-'}
          sub={snapshot.memTotal ? `${memPct}% used` : undefined}
          progress={memPct}
        />
        <ResourceTile
          icon={<HardDrive size={16} />}
          label="Disk"
          value={snapshot.diskTotal ? `${formatBytes(snapshot.diskUsed)} / ${formatBytes(snapshot.diskTotal)}` : '-'}
          sub={snapshot.diskTotal ? `${diskPct}% used` : undefined}
          progress={diskPct}
        />
        <ResourceTile
          icon={<Clock size={16} />}
          label="Uptime"
          value={formatUptime(snapshot.uptimeSince)}
          sub={snapshot.uptimeSince ? `since ${snapshot.uptimeSince}` : undefined}
        />
      </div>

      {/* System + extras */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="p-5 md:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-medium">System</h3>
            {snapshot.online ? <Badge variant="success">online</Badge> : <Badge variant="danger">offline</Badge>}
          </div>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <InfoRow label="OS" value={snapshot.osPretty} />
            <InfoRow label="Hostname" value={snapshot.hostname} />
            <InfoRow label="Kernel" value={snapshot.kernel} mono />
            <InfoRow label="Docker" value={snapshot.dockerVersion} />
            <InfoRow label="Reboot?" value={snapshot.rebootRequired ? <Badge variant="warning">required</Badge> : 'not needed'} />
            <InfoRow label="apt updates" value={(snapshot.aptUpgradable ?? 0) > 0 ? <Badge variant="info">{snapshot.aptUpgradable} available</Badge> : 'up to date'} />
          </dl>
          {server.notes && (
            <p className="mt-5 whitespace-pre-wrap rounded-md border border-border bg-background/40 p-3 text-xs text-muted-foreground">
              {server.notes}
            </p>
          )}
        </Card>

        <Card className="flex flex-col justify-between gap-4 p-5">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium">
              <ContainerIcon size={16} className="text-muted-foreground" />
              Docker
            </div>
            {snapshot.dockerVersion ? (
              <div className="mt-3 space-y-1">
                <div className="text-2xl font-semibold">
                  {containerRunning}
                  <span className="text-base font-normal text-muted-foreground"> / {containerCount} running</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {snapshot.composeProjects?.length ?? 0} compose project
                  {(snapshot.composeProjects?.length ?? 0) === 1 ? '' : 's'}
                </div>
              </div>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">Docker not installed</p>
            )}
          </div>
          <div className="rounded-md bg-background/60 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <TerminalSquare size={12} />
              Load avg
            </div>
            <div className="mt-1 font-mono text-sm">
              {snapshot.load1?.toFixed(2) ?? '-'} - {snapshot.load5?.toFixed(2) ?? '-'} - {snapshot.load15?.toFixed(2) ?? '-'}
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

function ResourceTile({
  icon,
  label,
  value,
  sub,
  progress
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
  progress?: number
}): JSX.Element {
  const tone = progress == null ? 'primary' : progress > 85 ? 'danger' : progress > 65 ? 'warning' : 'primary'
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          {icon}
          {label}
        </span>
      </div>
      <div className="mt-2 text-xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</div>}
      {progress != null && (
        <div className="mt-3">
          <Progress value={progress} tone={tone} />
        </div>
      )}
    </Card>
  )
}

function InfoRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`truncate text-right font-medium ${mono ? 'font-mono text-xs' : ''}`}>{value ?? '—'}</dd>
    </div>
  )
}

function StacksTab({ serverId, snapshot }: { serverId: string; snapshot: ServerSnapshot | null }): JSX.Element {
  const qc = useQueryClient()
  const [openStack, setOpenStack] = useState<string | null>(null)
  const [runningJob, setRunningJob] = useState<string | null>(null)

  const run = useMutation({
    mutationFn: async (input: { type: JobType; target?: string }) => {
      const r = await window.api.jobs.run({ serverId, type: input.type, target: input.target })
      return r.jobId
    },
    onSuccess: (jobId) => {
      setRunningJob(jobId)
      qc.invalidateQueries({ queryKey: ['jobs', serverId] })
    }
  })

  if (!snapshot) return <div className="text-muted-foreground">No data. Click Refresh.</div>
  const projects = snapshot.composeProjects ?? []
  const standalone = snapshot.standaloneContainers ?? []

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={() => run.mutate({ type: 'image-prune' })}>
          <Trash2 size={14} /> Prune images
        </Button>
      </div>
      {projects.length === 0 && standalone.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No Docker containers found.
        </div>
      )}
      {projects.map((p) => {
        const opened = openStack === p.name
        const updates = p.containers.filter((c) => c.updateAvailable).length
        const running = p.containers.filter((c) => c.state === 'running').length
        const total = p.containers.length
        const allRunning = total > 0 && running === total
        const noneRunning = running === 0
        const dotClass = allRunning
          ? 'bg-[hsl(var(--success))] shadow-[0_0_10px_currentColor]'
          : noneRunning
            ? 'bg-destructive'
            : 'bg-[hsl(var(--warning))]'
        return (
          <Card key={p.name} className="overflow-hidden">
            <button
              onClick={() => setOpenStack(opened ? null : p.name)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-accent/40"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                {opened ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} />
                <span className="truncate font-medium">{p.name}</span>
                <Badge
                  variant={allRunning ? 'success' : noneRunning ? 'danger' : 'warning'}
                  className="shrink-0"
                >
                  {running}/{total} running
                </Badge>
                {updates > 0 && (
                  <Badge variant="info" className="shrink-0">
                    {updates} update
                  </Badge>
                )}
                {!opened && (
                  <div className="ml-2 hidden min-w-0 flex-1 flex-wrap gap-1 overflow-hidden lg:flex">
                    {p.containers.slice(0, 6).map((c) => (
                      <span
                        key={c.id}
                        className="inline-flex items-center gap-1 rounded-md bg-background/40 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                        title={`${c.name} - ${c.status}`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${c.state === 'running' ? 'bg-[hsl(var(--success))]' : 'bg-destructive'}`}
                        />
                        <span className="max-w-[9rem] truncate">{c.name.replace(`${p.name}-`, '').replace(/-1$/, '')}</span>
                      </span>
                    ))}
                    {p.containers.length > 6 && (
                      <span className="text-[10px] text-muted-foreground">+{p.containers.length - 6}</span>
                    )}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 gap-1" onClick={(e) => e.stopPropagation()}>
                <Button size="sm" variant="secondary" onClick={() => run.mutate({ type: 'compose-pull', target: p.name })}>
                  <DownloadCloud size={14} /> Pull
                </Button>
                <Button size="sm" onClick={() => run.mutate({ type: 'compose-up', target: p.name })}>
                  <Play size={14} /> Update
                </Button>
                <Button size="sm" variant="secondary" onClick={() => run.mutate({ type: 'compose-restart', target: p.name })}>
                  <RotateCw size={14} /> Restart
                </Button>
              </div>
            </button>
            {opened && (
              <div className="divide-y divide-border">
                {p.containers.map((c) => (
                  <ContainerRow key={c.id} container={c} serverId={serverId} onRun={run.mutate} />
                ))}
              </div>
            )}
          </Card>
        )
      })}
      {standalone.length > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b border-border px-4 py-3 text-sm font-medium">Standalone containers</div>
          <div className="divide-y divide-border">
            {standalone.map((c) => (
              <ContainerRow key={c.id} container={c} serverId={serverId} onRun={run.mutate} />
            ))}
          </div>
        </Card>
      )}

      {runningJob && (
        <div className="mt-4 h-72">
          <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>Live log</span>
            <button className="hover:text-foreground" onClick={() => setRunningJob(null)}>
              hide
            </button>
          </div>
          <JobLog jobId={runningJob} />
        </div>
      )}
    </div>
  )
}

function ContainerRow({
  container,
  serverId,
  onRun
}: {
  container: ContainerInfo
  serverId: string
  onRun: (input: { type: JobType; target?: string }) => void
}): JSX.Element {
  void serverId
  const running = container.state === 'running'
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 text-sm">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span
          className={`h-2 w-2 rounded-full ${running ? 'bg-[hsl(var(--success))]' : 'bg-muted-foreground'}`}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{container.name}</div>
          <div className="truncate text-xs text-muted-foreground">
            {container.image} • {container.status}
          </div>
        </div>
        {container.updateAvailable && <Badge variant="info">update</Badge>}
      </div>
      <div className="flex items-center gap-1">
        {container.webUrls?.map((u) => (
          <a
            key={u}
            href={u}
            target="_blank"
            rel="noreferrer"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            title={u}
          >
            <ExternalLink size={14} />
          </a>
        ))}
        <Button size="icon" variant="ghost" title="Restart" onClick={() => onRun({ type: 'container-restart', target: container.name })}>
          <RotateCw size={14} />
        </Button>
        {running ? (
          <Button size="icon" variant="ghost" title="Stop" onClick={() => onRun({ type: 'container-stop', target: container.name })}>
            <StopCircle size={14} />
          </Button>
        ) : (
          <Button size="icon" variant="ghost" title="Start" onClick={() => onRun({ type: 'container-start', target: container.name })}>
            <Play size={14} />
          </Button>
        )}
      </div>
    </div>
  )
}

function PackagesTab({ serverId, snapshot }: { serverId: string; snapshot: ServerSnapshot | null }): JSX.Element {
  const qc = useQueryClient()
  const [runningJob, setRunningJob] = useState<string | null>(null)
  const [rebootPrompt, setRebootPrompt] = useState(false)
  const [rebootQueued, setRebootQueued] = useState(false)
  const run = useMutation({
    mutationFn: async (type: JobType) => (await window.api.jobs.run({ serverId, type })).jobId,
    onSuccess: (jobId) => {
      setRunningJob(jobId)
      qc.invalidateQueries({ queryKey: ['jobs', serverId] })
    }
  })

  // When an apt job on this server finishes successfully, refresh the snapshot
  // and if the server now requires a reboot, pop up the confirm dialog.
  useEffect(() => {
    if (!runningJob) return
    const off = window.api.events.on(IPC_EVENTS.jobLog, async (payload) => {
      const p = payload as { jobId: string; done?: boolean; status?: string }
      if (p.jobId !== runningJob || !p.done) return
      if (p.status === 'success') {
        try {
          const fresh = await window.api.servers.refresh(serverId)
          qc.invalidateQueries({ queryKey: ['snapshot', serverId] })
          qc.invalidateQueries({ queryKey: ['snapshots'] })
          if (fresh.rebootRequired) setRebootPrompt(true)
        } catch {
          /* ignore */
        }
      }
    })
    return off
  }, [runningJob, serverId, qc])

  const doReboot = async (): Promise<void> => {
    setRebootQueued(true)
    const r = await window.api.jobs.run({ serverId, type: 'reboot' })
    setRunningJob(r.jobId)
    setRebootPrompt(false)
    qc.invalidateQueries({ queryKey: ['jobs', serverId] })
  }

  if (!snapshot) return <div className="text-muted-foreground">No data.</div>
  const pkgs = snapshot.aptList ?? []
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <span className="font-medium">{pkgs.length}</span> upgradable package{pkgs.length === 1 ? '' : 's'}
          {snapshot.aptSecurity ? <span className="ml-2 text-[hsl(var(--warning))]">({snapshot.aptSecurity} security)</span> : null}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => run.mutate('apt-update')}>
            apt update
          </Button>
          <Button size="sm" disabled={pkgs.length === 0} onClick={() => run.mutate('apt-upgrade')}>
            <DownloadCloud size={14} /> apt upgrade
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={pkgs.length === 0}
            onClick={() => run.mutate('apt-full-upgrade')}
            title="Runs apt-get dist-upgrade. Use this if regular upgrade leaves packages 'kept back' because they need new or removed dependencies."
          >
            Full upgrade
          </Button>
          {snapshot.rebootRequired && (
            <Button size="sm" variant="destructive" onClick={() => run.mutate('reboot')}>
              <Power size={14} /> Reboot
            </Button>
          )}
        </div>
      </div>
      <Card className="divide-y divide-border">
        {pkgs.length === 0 && <div className="px-4 py-6 text-center text-sm text-muted-foreground">All packages up to date.</div>}
        {pkgs.map((p) => (
          <div key={p.name} className="flex items-center justify-between px-4 py-2 text-sm">
            <div>
              <div className="font-medium">{p.name}</div>
              <div className="font-mono text-xs text-muted-foreground">
                {p.from} → {p.to}
              </div>
            </div>
            {p.security && <Badge variant="warning">security</Badge>}
          </div>
        ))}
      </Card>
      {runningJob && (
        <div className="h-72">
          <JobLog jobId={runningJob} />
        </div>
      )}

      <Modal open={rebootPrompt} onClose={() => setRebootPrompt(false)} title="Reboot required">
        <p className="text-sm text-muted-foreground">
          The upgrade finished and the server marked itself as needing a reboot (<code>/var/run/reboot-required</code> exists).
          Do you want to reboot it now?
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setRebootPrompt(false)}>
            Later
          </Button>
          <Button variant="destructive" onClick={doReboot} disabled={rebootQueued}>
            <Power size={14} /> Reboot now
          </Button>
        </div>
      </Modal>
    </div>
  )
}

function HistoryTab({ jobs }: { jobs: Array<Awaited<ReturnType<typeof window.api.jobs.list>>[number]> }): JSX.Element {
  const [selected, setSelected] = useState<string | null>(jobs[0]?.id ?? null)
  // Keep selection valid when list updates
  useEffect(() => {
    if (!selected && jobs[0]) setSelected(jobs[0].id)
  }, [jobs, selected])

  return (
    <div className="grid grid-cols-3 gap-4">
      <Card className="col-span-1 max-h-[70vh] divide-y divide-border overflow-auto">
        {jobs.length === 0 && <div className="px-4 py-6 text-center text-sm text-muted-foreground">No jobs yet.</div>}
        {jobs.map((j) => (
          <button
            key={j.id}
            onClick={() => setSelected(j.id)}
            className={`flex w-full flex-col gap-1 px-3 py-2 text-left text-sm hover:bg-accent/50 ${selected === j.id ? 'bg-accent/60' : ''}`}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">
                {j.type} {j.target && <span className="text-muted-foreground">{j.target}</span>}
              </span>
              <StatusDot status={j.status} />
            </div>
            <div className="text-[11px] text-muted-foreground">{timeAgo(j.startedAt ?? null)}</div>
          </button>
        ))}
      </Card>
      <div className="col-span-2 h-[70vh]">{selected && <JobLog jobId={selected} />}</div>
    </div>
  )
}

function StatusDot({ status }: { status: string }): JSX.Element {
  const map: Record<string, string> = {
    success: 'bg-[hsl(var(--success))]',
    running: 'bg-primary animate-pulse',
    error: 'bg-destructive',
    queued: 'bg-muted-foreground',
    cancelled: 'bg-muted-foreground'
  }
  return <span className={`h-2 w-2 rounded-full ${map[status] ?? 'bg-muted-foreground'}`} />
}
