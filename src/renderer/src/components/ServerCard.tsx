import { motion } from 'framer-motion'
import { Cpu, HardDrive, MemoryStick, Container, DownloadCloud, AlertTriangle } from 'lucide-react'
import { Card, Progress, Badge } from './ui/primitives'
import { formatBytes, formatUptime, percent, osAccent } from '@/lib/utils'
import type { Server, ServerSnapshot } from '@shared/types'
import { useUI } from '../store'

export function ServerCard({ server, snapshot }: { server: Server; snapshot?: ServerSnapshot }): JSX.Element {
  const go = useUI((s) => s.go)
  const online = !!snapshot?.online
  const accent = osAccent(snapshot?.osName)
  const memPct = percent(snapshot?.memUsed, snapshot?.memTotal)
  const diskPct = percent(snapshot?.diskUsed, snapshot?.diskTotal)
  const cpuPct = snapshot?.cpuCores && snapshot?.load1 != null
    ? Math.min(100, Math.round((snapshot.load1 / snapshot.cpuCores) * 100))
    : 0
  const containers =
    (snapshot?.standaloneContainers?.length ?? 0) +
    (snapshot?.composeProjects?.reduce((s, p) => s + p.containers.length, 0) ?? 0)
  const containerUpdates =
    (snapshot?.standaloneContainers?.filter((c) => c.updateAvailable).length ?? 0) +
    (snapshot?.composeProjects?.reduce((s, p) => s + p.containers.filter((c) => c.updateAvailable).length, 0) ?? 0)

  return (
    <motion.button
      whileHover={{ y: -2 }}
      transition={{ duration: 0.15 }}
      onClick={() => go({ name: 'server', id: server.id })}
      className="text-left"
    >
      <Card className="flex h-full flex-col gap-4 p-5 transition-shadow hover:shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-lg text-white"
              style={{ background: `linear-gradient(135deg, ${accent}, ${server.color})` }}
            >
              <span className="text-sm font-semibold">{(server.name || server.host).slice(0, 2).toUpperCase()}</span>
            </div>
            <div>
              <div className="flex items-center gap-2 font-medium">{server.name || server.host}</div>
              <div className="text-xs text-muted-foreground">{server.host}</div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span
              className={`h-2 w-2 rounded-full ${online ? 'bg-[hsl(var(--success))] shadow-[0_0_10px_currentColor]' : 'bg-destructive'}`}
            />
            {snapshot?.rebootRequired && (
              <Badge variant="warning" className="text-[10px]">
                <AlertTriangle size={10} /> reboot
              </Badge>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          {snapshot?.osPretty && <Badge variant="outline">{snapshot.osPretty}</Badge>}
          {snapshot?.uptimeSince && <span>up {formatUptime(snapshot.uptimeSince)}</span>}
          {snapshot?.dockerVersion && <Badge variant="outline">docker {snapshot.dockerVersion}</Badge>}
        </div>

        <div className="space-y-2">
          <Metric icon={<Cpu size={12} />} label="CPU" value={`${cpuPct}%`} progress={cpuPct} tone={cpuPct > 85 ? 'danger' : cpuPct > 60 ? 'warning' : 'primary'} />
          <Metric icon={<MemoryStick size={12} />} label="RAM" value={snapshot?.memTotal ? `${formatBytes(snapshot.memUsed)} / ${formatBytes(snapshot.memTotal)}` : '-'} progress={memPct} tone={memPct > 85 ? 'danger' : memPct > 60 ? 'warning' : 'primary'} />
          <Metric icon={<HardDrive size={12} />} label="Disk" value={snapshot?.diskTotal ? `${formatBytes(snapshot.diskUsed)} / ${formatBytes(snapshot.diskTotal)}` : '-'} progress={diskPct} tone={diskPct > 85 ? 'danger' : diskPct > 70 ? 'warning' : 'primary'} />
        </div>

        <div className="mt-auto flex items-center justify-between pt-2 text-xs">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Container size={14} />
            <span>{containers} container</span>
            {containerUpdates > 0 && <Badge variant="info">{containerUpdates} update</Badge>}
          </div>
          <div className="flex items-center gap-2">
            {snapshot?.aptUpgradable && snapshot.aptUpgradable > 0 ? (
              <Badge variant={snapshot.aptSecurity && snapshot.aptSecurity > 0 ? 'warning' : 'info'}>
                <DownloadCloud size={10} /> {snapshot.aptUpgradable} apt
              </Badge>
            ) : null}
          </div>
        </div>
      </Card>
    </motion.button>
  )
}

function Metric({
  icon,
  label,
  value,
  progress,
  tone
}: {
  icon: React.ReactNode
  label: string
  value: string
  progress: number
  tone: 'primary' | 'warning' | 'danger' | 'success'
}): JSX.Element {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          {icon}
          <span>{label}</span>
        </div>
        <span className="font-mono">{value}</span>
      </div>
      <Progress value={progress} tone={tone} />
    </div>
  )
}
