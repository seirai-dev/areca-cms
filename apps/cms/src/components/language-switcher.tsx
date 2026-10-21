import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import { getLocale, locales, setLocale } from '#/paraglide/runtime'
import type { Locale } from '#/paraglide/runtime'
import { Check, Globe } from '@phosphor-icons/react'

export const LOCALE_LABELS = {
  en: 'English',
  nl: 'Nederlands',
  tr: 'Türkçe',
} as const satisfies Record<Locale, string>

export function LanguageSwitcher({
  className,
  compact = false,
}: {
  className?: string
  compact?: boolean
}) {
  const locale = getLocale()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={compact ? 'icon-sm' : 'sm'}
          aria-label={m.shell_language()}
          data-testid="language-switcher"
          className={cn(!compact && 'gap-1.5', className)}
        >
          <Globe />
          {compact ? null : <span>{LOCALE_LABELS[locale]}</span>}
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
