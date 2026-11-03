import { useEffect, useState } from 'react'
import { Moon, Sun } from '@phosphor-icons/react'
import { m } from '@/paraglide/messages'
import { applyTheme, readTheme } from '@/lib/theme'
import type { Theme } from '@/lib/theme'

export function ThemeToggle() {
  // The server renders the default (dark); the real value is read on mount.
  const [theme, setTheme] = useState<Theme>('dark')
  useEffect(() => setTheme(readTheme()), [])
  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <button
      type="button"
      onClick={() => {
        applyTheme(next)
        setTheme(next)
      }}
      aria-label={next === 'light' ? m.theme_to_light() : m.theme_to_dark()}
      className="grid size-9 place-items-center rounded-full text-muted transition-colors hover:bg-raised hover:text-fg"
    >
      {theme === 'dark' ? (
        <Sun size={18} weight="regular" />
      ) : (
        <Moon size={18} weight="regular" />
      )}
    </button>
  )
}
