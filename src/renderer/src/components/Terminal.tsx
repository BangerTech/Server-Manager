import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { IPC_EVENTS } from '@shared/types'

export function Terminal({ serverId }: { serverId: string }): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const sessionRef = useRef<string | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const term = new XTerm({
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", "Consolas", "Fira Code", monospace',
      fontSize: 13,
      theme: {
        background: '#0b0d12',
        foreground: '#e5e7eb',
        cursor: '#6366f1',
        selectionBackground: '#6366f160'
      },
      allowProposedApi: true
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current)
    fit.fit()
    termRef.current = term
    fitRef.current = fit

    let disposed = false
    let offData: (() => void) | null = null
    let offExit: (() => void) | null = null

    void window.api.terminal.open(serverId, { cols: term.cols, rows: term.rows }).then(({ sessionId }) => {
      if (disposed) {
        void window.api.terminal.close(sessionId)
        return
      }
      sessionRef.current = sessionId
      offData = window.api.events.on(IPC_EVENTS.terminalData, (p) => {
        const payload = p as { sessionId: string; data: string }
        if (payload.sessionId === sessionId) term.write(payload.data)
      })
      offExit = window.api.events.on(IPC_EVENTS.terminalExit, (p) => {
        const payload = p as { sessionId: string; code: number | null }
        if (payload.sessionId === sessionId) term.writeln(`\r\n\x1b[33m[session closed, code ${payload.code ?? '?'}]\x1b[0m`)
      })
      term.onData((data) => void window.api.terminal.write(sessionId, data))
    })

    const resize = (): void => {
      try {
        fit.fit()
        if (sessionRef.current) void window.api.terminal.resize(sessionRef.current, term.cols, term.rows)
      } catch {
        /* ignore */
      }
    }
    const obs = new ResizeObserver(resize)
    obs.observe(containerRef.current)
    window.addEventListener('resize', resize)

    return () => {
      disposed = true
      offData?.()
      offExit?.()
      obs.disconnect()
      window.removeEventListener('resize', resize)
      if (sessionRef.current) void window.api.terminal.close(sessionRef.current)
      term.dispose()
    }
  }, [serverId])

  return <div ref={containerRef} className="h-full w-full overflow-hidden rounded-lg border border-border bg-[#0b0d12] p-2" />
}
