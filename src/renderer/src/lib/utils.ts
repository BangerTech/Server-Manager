import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function formatBytes(bytes: number | undefined, decimals = 1): string {
  if (!bytes || bytes <= 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1)
  return `${(bytes / Math.pow(k, i)).toFixed(decimals)} ${sizes[i]}`
}

export function formatUptime(sinceIso: string | undefined): string {
  if (!sinceIso) return '-'
  const since = new Date(sinceIso.replace(' ', 'T')).getTime()
  if (Number.isNaN(since)) return sinceIso
  const diff = Date.now() - since
  const days = Math.floor(diff / (24 * 3600 * 1000))
  const hours = Math.floor((diff % (24 * 3600 * 1000)) / (3600 * 1000))
  const mins = Math.floor((diff % (3600 * 1000)) / 60000)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

export function percent(used: number | undefined, total: number | undefined): number {
  if (!used || !total || total <= 0) return 0
  return Math.min(100, Math.round((used / total) * 100))
}

export function timeAgo(ts: number | null | undefined): string {
  if (!ts) return 'never'
  const diff = Date.now() - ts
  if (diff < 1000) return 'just now'
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

export function osAccent(osName: string | undefined): string {
  switch ((osName ?? '').toLowerCase()) {
    case 'debian':
      return '#c70036'
    case 'ubuntu':
      return '#e95420'
    case 'raspbian':
      return '#be1848'
    case 'alpine':
      return '#0d597f'
    case 'fedora':
      return '#294172'
    case 'arch':
      return '#1793d1'
    case 'proxmox':
      return '#e57000'
    default:
      return '#6366f1'
  }
}
