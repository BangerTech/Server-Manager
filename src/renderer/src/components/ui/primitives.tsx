import * as React from 'react'
import { cn } from '@/lib/utils'

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('glass rounded-xl', className)} {...props} />
  )
)
Card.displayName = 'Card'

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-background/60 px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
)
Input.displayName = 'Input'

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[60px] w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        className
      )}
      {...props}
    />
  )
)
Textarea.displayName = 'Textarea'

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>): JSX.Element {
  return <label className={cn('text-xs font-medium text-muted-foreground', className)} {...props} />
}

export function Badge({
  children,
  variant = 'default',
  className
}: {
  children: React.ReactNode
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'outline'
  className?: string
}): JSX.Element {
  const variants: Record<string, string> = {
    default: 'bg-accent text-accent-foreground',
    success: 'bg-success/15 text-[hsl(var(--success))] border border-[hsl(var(--success))]/30',
    warning: 'bg-warning/15 text-[hsl(var(--warning))] border border-[hsl(var(--warning))]/30',
    danger: 'bg-destructive/15 text-destructive border border-destructive/30',
    info: 'bg-info/15 text-[hsl(var(--info))] border border-[hsl(var(--info))]/30',
    outline: 'border border-border text-muted-foreground'
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
        variants[variant],
        className
      )}
    >
      {children}
    </span>
  )
}

export function Progress({ value, className, tone = 'primary' }: { value: number; className?: string; tone?: 'primary' | 'warning' | 'danger' | 'success' }): JSX.Element {
  const color: Record<string, string> = {
    primary: 'bg-primary',
    warning: 'bg-[hsl(var(--warning))]',
    danger: 'bg-destructive',
    success: 'bg-[hsl(var(--success))]'
  }
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}>
      <div
        className={cn('h-full transition-all', color[tone])}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  )
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide
}: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  wide?: boolean
}): JSX.Element | null {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={cn('glass max-h-[85vh] w-full max-w-lg overflow-auto rounded-xl p-6 shadow-2xl', wide && 'max-w-3xl')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="close"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Tabs({
  items,
  active,
  onChange
}: {
  items: Array<{ id: string; label: string; icon?: React.ReactNode }>
  active: string
  onChange: (id: string) => void
}): JSX.Element {
  return (
    <div className="flex items-center gap-1 border-b border-border">
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => onChange(item.id)}
          className={cn(
            'relative inline-flex items-center gap-2 px-3 py-2 text-sm transition-colors',
            active === item.id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {item.icon}
          {item.label}
          {active === item.id && (
            <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />
          )}
        </button>
      ))}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action
}: {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
}): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-6 py-16 text-center">
      {icon && <div className="text-muted-foreground">{icon}</div>}
      <h3 className="text-base font-medium">{title}</h3>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action}
    </div>
  )
}

export function Spinner({ className }: { className?: string }): JSX.Element {
  return (
    <svg
      className={cn('h-4 w-4 animate-spin text-current', className)}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  )
}
