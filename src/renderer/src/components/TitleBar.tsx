import { Server } from 'lucide-react'

export function TitleBar(): JSX.Element {
  return (
    <div className="app-drag flex h-9 shrink-0 items-center justify-between border-b border-border bg-background/95 px-3 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <Server size={14} className="text-primary" />
        <span className="font-medium text-foreground">Server Manager</span>
      </div>
      <div className="opacity-60">v0.1.0</div>
    </div>
  )
}
