import { useEffect, useMemo, useState } from 'react'
import { useUI, type Page } from '../store'
import { useQuery } from '@tanstack/react-query'
import { Modal, Input } from './ui/primitives'
import { LayoutDashboard, Server as ServerIcon, DownloadCloud, Search, Hammer, Settings as SettingsIcon, Zap } from 'lucide-react'

interface Item {
  id: string
  label: string
  hint?: string
  icon: React.ReactNode
  run: () => void
}

export function CommandPalette(): JSX.Element {
  const open = useUI((s) => s.commandOpen)
  const close = () => useUI.getState().setCommandOpen(false)
  const go = useUI((s) => s.go)
  const [q, setQ] = useState('')
  const { data: servers } = useQuery({ queryKey: ['servers'], queryFn: () => window.api.servers.list() })

  const nav: Array<{ page: Page; label: string; icon: React.ReactNode }> = [
    { page: { name: 'dashboard' }, label: 'Dashboard', icon: <LayoutDashboard size={14} /> },
    { page: { name: 'servers' }, label: 'Servers', icon: <ServerIcon size={14} /> },
    { page: { name: 'updates' }, label: 'Updates', icon: <DownloadCloud size={14} /> },
    { page: { name: 'scan' }, label: 'Scan', icon: <Search size={14} /> },
    { page: { name: 'jobs' }, label: 'Jobs', icon: <Hammer size={14} /> },
    { page: { name: 'settings' }, label: 'Settings', icon: <SettingsIcon size={14} /> }
  ]

  const items = useMemo<Item[]>(() => {
    const navItems: Item[] = nav.map((n) => ({
      id: `nav-${n.page.name}`,
      label: n.label,
      icon: n.icon,
      run: () => {
        go(n.page)
        close()
      }
    }))
    const serverItems: Item[] =
      servers?.map((s) => ({
        id: `srv-${s.id}`,
        label: s.name,
        hint: s.host,
        icon: <ServerIcon size={14} style={{ color: s.color }} />,
        run: () => {
          go({ name: 'server', id: s.id })
          close()
        }
      })) ?? []
    const actionItems: Item[] = [
      {
        id: 'act-refresh-all',
        label: 'Refresh all servers',
        icon: <Zap size={14} />,
        run: () => {
          void window.api.servers.refreshAll()
          close()
        }
      }
    ]
    return [...navItems, ...serverItems, ...actionItems]
  }, [servers, go])

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return items
    return items.filter((i) => i.label.toLowerCase().includes(t) || i.hint?.toLowerCase().includes(t))
  }, [q, items])

  useEffect(() => {
    if (!open) setQ('')
  }, [open])

  return (
    <Modal open={open} onClose={close} title="Command Palette">
      <Input autoFocus placeholder="Type to search..." value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="mt-4 max-h-72 overflow-y-auto">
        {filtered.map((item) => (
          <button
            key={item.id}
            onClick={item.run}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
          >
            <span className="text-muted-foreground">{item.icon}</span>
            <span className="flex-1">{item.label}</span>
            {item.hint && <span className="text-xs text-muted-foreground">{item.hint}</span>}
          </button>
        ))}
        {filtered.length === 0 && <div className="py-6 text-center text-sm text-muted-foreground">No matches</div>}
      </div>
    </Modal>
  )
}
