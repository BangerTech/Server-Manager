import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, Pencil, Server as ServerIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, EmptyState, Badge } from '@/components/ui/primitives'
import { ServerDialog } from '@/components/ServerDialog'
import { useUI } from '@/store'
import type { Server } from '@shared/types'

export function Servers(): JSX.Element {
  const { data: servers } = useQuery({ queryKey: ['servers'], queryFn: () => window.api.servers.list() })
  const [editing, setEditing] = useState<Server | null>(null)
  const [open, setOpen] = useState(false)
  const go = useUI((s) => s.go)

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Servers</h1>
        <Button
          onClick={() => {
            setEditing(null)
            setOpen(true)
          }}
        >
          <Plus size={14} /> Add server
        </Button>
      </header>

      {servers && servers.length === 0 ? (
        <EmptyState
          icon={<ServerIcon size={28} />}
          title="No servers yet"
          description="Add servers one by one, or run a network scan."
          action={
            <Button onClick={() => setOpen(true)}>
              <Plus size={14} /> Add server
            </Button>
          }
        />
      ) : (
        <Card className="divide-y divide-border">
          {servers?.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <button
                onClick={() => go({ name: 'server', id: s.id })}
                className="flex flex-1 items-center gap-3 text-left"
              >
                <span className="h-3 w-3 rounded-full" style={{ background: s.color }} />
                <div>
                  <div className="font-medium">{s.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {s.host}:{s.port}
                  </div>
                </div>
                <div className="ml-4 flex flex-wrap gap-1">
                  {s.tags.map((t) => (
                    <Badge key={t} variant="outline">
                      {t}
                    </Badge>
                  ))}
                </div>
              </button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setEditing(s)
                  setOpen(true)
                }}
              >
                <Pencil size={14} />
              </Button>
            </div>
          ))}
        </Card>
      )}

      <ServerDialog open={open} onClose={() => setOpen(false)} server={editing} />
    </div>
  )
}
