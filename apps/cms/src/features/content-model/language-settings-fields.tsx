import * as React from 'react'
import { CaretDown, Check, Lock } from '@phosphor-icons/react'

import { FormField } from '#/components/ui/form-field'
import { Input } from '#/components/ui/input'
import { Hint } from '#/components/ui/tooltip'
import { nonMainLanguages, uiLanguageName } from '#/lib/site-languages'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import type { SiteLanguages } from '#/lib/types'

/**
 * Settings fields for a collection or section on a multilingual site (2+
 * languages). Shown only when the site has them; see
 * docs/design/content-languages.md.
 */

/** "Required languages": toggle chips, main always on and locked. */
export function RequiredLanguagesSection({
  languages,
  required,
  onToggle,
}: {
  languages: SiteLanguages
  required: string[]
  onToggle: (locale: string) => void
}) {
  return (
    <section className="grid gap-2" data-testid="required-languages">
      <h3 className="px-1 text-overline text-text-muted">
        {m.languages_required_title()}
      </h3>
      <div className="grid gap-3 surface-card p-4">
        <p className="text-callout text-text-secondary">
          {m.languages_required_hint()}
        </p>
        <div
          role="group"
          aria-label={m.languages_required_title()}
          className="flex flex-wrap gap-2"
        >
          {languages.all.map((locale) => {
            const name = uiLanguageName(locale)
            if (locale === languages.main) {
              return (
                <Hint key={locale} label={m.languages_required_main_locked()}>
                  <span
                    tabIndex={0}
                    aria-disabled="true"
                    aria-label={`${name} (${m.languages_main_label()})`}
                    data-testid={`required-language-${locale}`}
                    data-locked="true"
                    className="inline-flex h-8 cursor-default items-center gap-1.5 rounded-full border border-border-default bg-background-subtle px-3 text-callout font-medium text-text-secondary outline-none focus-visible:outline-2 focus-visible:outline-border-focus"
                  >
                    <Lock className="size-3.5" />
                    {name}
                  </span>
                </Hint>
              )
            }
            const on = required.includes(locale)
            return (
              <button
                key={locale}
                type="button"
                aria-pressed={on}
                data-testid={`required-language-${locale}`}
                onClick={() => onToggle(locale)}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-callout font-medium outline-none transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-border-focus',
                  on
                    ? 'border-accent bg-accent-soft text-text-accent'
                    : 'border-border-default text-text-secondary hover:bg-surface-state-hover',
                )}
              >
                {on ? <Check weight="bold" className="size-3.5" /> : null}
                {name}
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}

/** "Translate URL path": one pattern per non-main language, blank = main. */
export function LocalizedRoutesSection({
  languages,
  mainPattern,
  routes,
  error,
  onChange,
}: {
  languages: SiteLanguages
  mainPattern: string
  routes: Record<string, string>
  error: string | null
  onChange: (locale: string, pattern: string) => void
}) {
  const others = nonMainLanguages(languages)
  const hasRoutes = others.some(
    (locale) => (routes[locale] ?? '').trim() !== '',
  )
  const [open, setOpen] = React.useState(hasRoutes)
  const panelId = React.useId()

  return (
    <section className="grid gap-2" data-testid="localized-routes-section">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center justify-between gap-2 rounded-[8px] px-1 py-0.5 text-left outline-none focus-visible:outline-2 focus-visible:outline-border-focus"
        data-testid="localized-routes-toggle"
      >
        <span className="text-overline text-text-muted">
          {m.languages_routes_title()}
        </span>
        <CaretDown
          className={cn(
            'size-3.5 text-icon-muted transition-transform duration-150',
            open && 'rotate-180',
          )}
        />
      </button>
      {open ? (
        <div id={panelId} className="grid gap-4 surface-card p-4">
          <p className="text-callout text-text-secondary">
            {m.languages_routes_hint()}
          </p>
          {others.map((locale) => {
            const name = uiLanguageName(locale)
            const id = `localized-route-${locale}`
            return (
              <FormField
                key={locale}
                label={m.languages_route_label({ language: name })}
                htmlFor={id}
                error={locale === others[0] ? (error ?? undefined) : undefined}
              >
                <Input
                  id={id}
                  data-testid={id}
                  className="font-mono text-[13px]"
                  spellCheck={false}
                  autoCapitalize="off"
                  placeholder={mainPattern}
                  value={routes[locale] ?? ''}
                  aria-invalid={error ? true : undefined}
                  onChange={(event) => onChange(locale, event.target.value)}
                />
              </FormField>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}
