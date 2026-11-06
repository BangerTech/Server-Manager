import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card } from '@/components/ui/primitives'
import { JobLog } from '@/components/JobLog'
import { timeAgo } from '@/lib/utils'

export function Jobs(): JSX.Element {
  const { data: jobs } = useQuery({
    queryKey: ['jobs'],
    queryFn: () => window.api.jobs.list(),
    refetchInterval: 3000
  })
  const { data: servers } = useQuery({ queryKey: ['servers'], queryFn: () => window.api.servers.list() })
  const nameById = new Map(servers?.map((s) => [s.id, s.name]))
  const [selected, setSelected] = useState<string | null>(null)

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <h1 className="text-2xl font-semibold">Jobs</h1>
      <div className="grid grid-cols-3 gap-4">
        <Card className="col-span-1 max-h-[75vh] divide-y divide-border overflow-auto">
          {(jobs ?? []).length === 0 && <div className="px-4 py-6 text-center text-sm text-muted-foreground">No jobs.</div>}
          {jobs?.map((j) => (
            <button
              key={j.id}
              onClick={() => setSelected(j.id)}
              className={`flex w-full flex-col gap-1 px-3 py-2 text-left text-sm hover:bg-accent/40 ${selected === j.id ? 'bg-accent/60' : ''}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {j.type} {j.target && <span className="text-muted-foreground">· {j.target}</span>}
                </span>
                <span className={`h-2 w-2 rounded-full ${dot(j.status)}`} />
              </div>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{nameById.get(j.serverId) ?? j.serverId}</span>
                <span>{timeAgo(j.startedAt)}</span>
              </div>
            </button>
          ))}
        </Card>
        <div className="col-span-2 h-[75vh]">{selected && <JobLog jobId={selected} />}</div>
      </div>
    </div>
  )
}

function dot(status: string): string {
  if (status === 'success') return 'bg-[hsl(var(--success))]'
  if (status === 'running') return 'bg-primary animate-pulse'
  if (status === 'error') return 'bg-destructive'
  return 'bg-muted-foreground'
}
