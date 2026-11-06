import { LayoutDashboard, Server as ServerIcon, DownloadCloud, Search, Hammer, Settings as SettingsIcon } from 'lucide-react'
import { useUI, type Page } from '../store'
import { cn } from '@/lib/utils'
import { useQuery } from '@tanstack/react-query'

const items: Array<{ page: Page; label: string; icon: React.ReactNode }> = [
  { page: { name: 'dashboard' }, label: 'Dashboard', icon: <LayoutDashboard size={16} /> },
  { page: { name: 'servers' }, label: 'Servers', icon: <ServerIcon size={16} /> },
  { page: { name: 'updates' }, label: 'Updates', icon: <DownloadCloud size={16} /> },
  { page: { name: 'scan' }, label: 'Scan', icon: <Search size={16} /> },
  { page: { name: 'jobs' }, label: 'Jobs', icon: <Hammer size={16} /> },
  { page: { name: 'settings' }, label: 'Settings', icon: <SettingsIcon size={16} /> }
]

export function Sidebar(): JSX.Element {
  const page = useUI((s) => s.page)
  const go = useUI((s) => s.go)
  const { data: snapshots } = useQuery({
    queryKey: ['snapshots'],
    queryFn: () => window.api.servers.listSnapshots()
  })
  const online = snapshots?.filter((s) => s.online).length ?? 0
  const total = snapshots?.length ?? 0
  const updates =
    snapshots?.reduce((sum, s) => sum + (s.aptUpgradable ?? 0), 0) ?? 0

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-background/60 p-3">
      <nav className="flex flex-col gap-1">
        {items.map((item) => {
          const active = item.page.name === page.name || (item.page.name === 'servers' && page.name === 'server')
          return (
            <button
              key={item.page.name}
              onClick={() => go(item.page)}
              className={cn(
                'group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-primary/15 text-foreground shadow-inner'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              <span className={cn('transition-colors', active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground')}>
                {item.icon}
              </span>
              <span className="flex-1 text-left">{item.label}</span>
              {item.page.name === 'updates' && updates > 0 && (
                <span className="rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] text-primary">{updates}</span>
              )}
            </button>
          )
        })}
      </nav>
      <div className="mt-auto rounded-lg border border-border bg-card/40 p-3 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Online</span>
          <span className="font-mono font-medium">
            {online}/{total}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-muted-foreground">Ctrl+K</span>
          <span className="text-muted-foreground/70">Command</span>
        </div>
      </div>
    </aside>
  )
}
