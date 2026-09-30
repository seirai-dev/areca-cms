import * as React from 'react'

import type { MeSite } from '#/lib/site-nav'
import type { Me } from '#/server/fn/me'

/**
 * - `site`   a site workspace (sidebar with content nav and Go‑live tray)
 * - `agency` the Agency workspace sidebar
 * - `bare`   no workspace yet (the `/sites` picker): slim top bar only
 * - `focus`  the entry editor: no sidebar at all
 */
export type ShellMode = 'site' | 'agency' | 'bare' | 'focus'

export type ShellValue = {
  me: Me
  mode: ShellMode
  site: MeSite | undefined
  paletteOpen: boolean
  setPaletteOpen: (open: boolean) => void
  shortcutsOpen: boolean
  setShortcutsOpen: (open: boolean) => void
  switcherOpen: boolean
  setSwitcherOpen: (open: boolean) => void
}

export const ShellContext = React.createContext<ShellValue | null>(null)

export function useShell() {
  const value = React.useContext(ShellContext)
  if (!value) throw new Error('useShell must be used inside <AppShell>')
  return value
}
