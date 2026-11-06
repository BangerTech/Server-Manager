import { create } from 'zustand'

export type Page =
  | { name: 'dashboard' }
  | { name: 'servers' }
  | { name: 'server'; id: string }
  | { name: 'updates' }
  | { name: 'scan' }
  | { name: 'jobs' }
  | { name: 'settings' }

interface UIState {
  page: Page
  go: (p: Page) => void
  commandOpen: boolean
  setCommandOpen: (v: boolean) => void
}

export const useUI = create<UIState>((set) => ({
  page: { name: 'dashboard' },
  go: (p) => set({ page: p }),
  commandOpen: false,
  setCommandOpen: (v) => set({ commandOpen: v })
}))
