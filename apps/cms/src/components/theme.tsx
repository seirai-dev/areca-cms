import * as React from 'react'
import type { ReactNode } from 'react'
import { ThemeProvider as NextThemesProvider, useTheme } from 'next-themes'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { useCspNonce } from '#/hooks/use-csp-nonce'
import { m } from '#/paraglide/messages'
import { Monitor, Moon, Sun } from '@phosphor-icons/react'

/**
 * Theme is a class on `<html>` so the `.dark` token block and the branding
 * stylesheet (`:root:not(.dark)` / `.dark`) both keep working. Default follows
 * the OS; the choice is persisted by next-themes in localStorage.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  // next-themes writes an inline script (before first paint) and a style that
  // suppresses transitions while the theme changes. Both need the nonce.
  const nonce = useCspNonce()
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey="areca.theme"
      nonce={nonce}
    >
      {children}
    </NextThemesProvider>
  )
}

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  // The stored choice is only known in the browser. Until mounted, show the
  // server's icon so the first client render matches the HTML it hydrates.
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])
  const shown = mounted ? theme : undefined
  const Icon = shown === 'dark' ? Moon : shown === 'light' ? Sun : Monitor

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={m.shell_theme()}
          data-testid="theme-toggle"
          className={className}
        >
          <Icon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => setTheme('light')}>
          <Sun />
          {m.shell_theme_light()}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme('dark')}>
          <Moon />
          {m.shell_theme_dark()}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme('system')}>
          <Monitor />
          {m.shell_theme_system()}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
