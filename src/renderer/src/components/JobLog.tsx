import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { IPC_EVENTS } from '@shared/types'

export function JobLog({ jobId }: { jobId: string }): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<XTerm | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const term = new XTerm({
      disableStdin: true,
      convertEol: true,
      fontFamily: '"JetBrains Mono", "Consolas", monospace',
      fontSize: 12,
      theme: { background: '#0b0d12', foreground: '#e5e7eb' }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current)
    fit.fit()
    termRef.current = term

    // Replay existing log and subscribe to streaming updates.
    let off: (() => void) | null = null
    void window.api.jobs.get(jobId).then((job) => {
      if (job?.log) term.write(job.log)
      off = window.api.events.on(IPC_EVENTS.jobLog, (p) => {
        const payload = p as { jobId: string; chunk: string }
        if (payload.jobId === jobId) term.write(payload.chunk)
      })
    })

    const resize = (): void => {
      try {
        fit.fit()
      } catch {
        /* ignore */
      }
    }
    const obs = new ResizeObserver(resize)
    obs.observe(containerRef.current)

    return () => {
      off?.()
      obs.disconnect()
      term.dispose()
    }
  }, [jobId])

  return <div ref={containerRef} className="h-full w-full rounded-lg border border-border bg-[#0b0d12] p-2" />
}
