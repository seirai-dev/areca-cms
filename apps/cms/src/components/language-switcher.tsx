import type { ReactNode } from 'react'
import { Check, Globe } from 'lucide-react'

import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import { getLocale, locales, setLocale, type Locale } from '#/paraglide/runtime'

const LOCALE_LABELS = {
  en: 'English',
  nl: 'Nederlands',
  tr: 'Türkçe',
} as const satisfies Record<Locale, string>

export function LanguageSwitcher({ className }: { className?: string }) {
  const locale = getLocale()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={m.shell_language()}
          data-testid="language-switcher"
          className={cn('gap-1.5', className)}
        >
          <Globe />
          <span>{LOCALE_LABELS[locale]}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {locales.map((code) => (
          <DropdownMenuItem
            key={code}
            onSelect={() => setLocale(code)}
            data-testid={`language-${code}`}
          >
            <span>{LOCALE_LABELS[code]}</span>
            {code === locale ? <Check className="ml-auto size-4" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-svh items-center justify-center p-6">
      <LanguageSwitcher className="absolute top-4 right-4" />
      {children}
    </div>
  )
}
