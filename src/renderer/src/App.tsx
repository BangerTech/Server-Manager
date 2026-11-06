import { useEffect } from 'react'
import { Sidebar } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import { useUI } from './store'
import { Dashboard } from './pages/Dashboard'
import { Servers } from './pages/Servers'
import { ServerDetail } from './pages/ServerDetail'
import { Updates } from './pages/Updates'
import { Scan } from './pages/Scan'
import { Jobs } from './pages/Jobs'
import { Settings } from './pages/Settings'
import { CommandPalette } from './components/CommandPalette'
import { useQueryClient } from '@tanstack/react-query'
import { IPC_EVENTS } from '@shared/types'

export default function App(): JSX.Element {
  const page = useUI((s) => s.page)
  const setCommandOpen = useUI((s) => s.setCommandOpen)
  const qc = useQueryClient()

  // Global shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCommandOpen(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setCommandOpen])

  // Push events -> invalidate queries so UI updates in real time
  useEffect(() => {
    const offs = [
      window.api.events.on(IPC_EVENTS.snapshotUpdated, () => {
        qc.invalidateQueries({ queryKey: ['snapshots'] })
      }),
      window.api.events.on(IPC_EVENTS.jobLog, () => {
        qc.invalidateQueries({ queryKey: ['jobs'] })
      })
    ]
    return () => offs.forEach((o) => o())
  }, [qc])

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-h-0 flex-1 overflow-auto bg-gradient-to-br from-background to-background/70 p-6">
          {renderPage(page)}
        </main>
      </div>
      <CommandPalette />
    </div>
  )
}

function renderPage(page: ReturnType<typeof useUI.getState>['page']): JSX.Element {
  switch (page.name) {
    case 'dashboard':
      return <Dashboard />
    case 'servers':
      return <Servers />
    case 'server':
      return <ServerDetail serverId={page.id} />
    case 'updates':
      return <Updates />
    case 'scan':
      return <Scan />
    case 'jobs':
      return <Jobs />
    case 'settings':
      return <Settings />
  }
}
