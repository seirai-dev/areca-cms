import * as React from 'react'
import { useReducedMotion } from 'motion/react'
import * as motion from 'motion/react-m'

import { KbdCombo } from '#/components/ui/kbd'
import { Hint } from '#/components/ui/tooltip'
import { SPRING_SMALL } from '#/lib/motion'
import { languageEndonym, uiLanguageName } from '#/lib/site-languages'
import { cn } from '#/lib/utils'
import type { Field } from '#/lib/types'
import { m } from '#/paraglide/messages'

import { LanguageRing } from './language-ring'
import { fieldLabels, languageCode } from './language-state'
import type { LocaleSummary } from './language-state'

/** Height of the language row inside the sticky editor header. */
export const LANGUAGE_BAR_HEIGHT = 44

/** Tooltip text for one language: state, missing fields, required. */
export function languageTooltip(
  summary: LocaleSummary,
  name: string,
  fields: Field[],
): string {
  const { status, missing } = summary
  if (status.complete && status.started) {
    return m.editor_language_tip_complete({ language: name })
  }
  if (!status.started) {
    return m.editor_language_tip_not_started({ language: name })
  }
  const labels = fieldLabels(missing, fields).join(', ')
  return missing.length === 1
    ? m.editor_language_tip_missing_one({ language: name, fields: labels })
    : m.editor_language_tip_missing_other({
        language: name,
        count: missing.length,
        fields: labels,
      })
}

/**
 * Language tabs for an entry or section (brief §3.5 / content languages).
 * One `role=tab` per language in site order, a completion ring per tab, the
 * main language marked "Main", and the required languages drawn in the
 * warning tone when incomplete. Roving tabindex: arrows, Home and End move
 * within the bar. Sits inside the sticky header, under the 56px row.
 *
 * `trailing` holds the "Translate from <main>" action. With it, the shared
 * hint hides first when the bar is too narrow for both (container query).
 */
export function LanguageBar({
  main,
  active,
  summaries,
  fields,
  onSelect,
  trailing,
}: {
  /** Main language tag. */
  main: string
  active: string
  summaries: LocaleSummary[]
  fields: Field[]
  onSelect: (code: string) => void
  trailing?: React.ReactNode
}) {
  const reduce = useReducedMotion()
  const listRef = React.useRef<HTMLDivElement>(null)
  const isMain = active === main

  React.useEffect(() => {
    const tab = listRef.current?.querySelector<HTMLElement>(
      '[role="tab"][aria-selected="true"]',
    )
    tab?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const codes = summaries.map((summary) => summary.locale)
    const index = codes.indexOf(active)
    let next: number | null = null
    if (event.key === 'ArrowRight') next = (index + 1) % codes.length
    else if (event.key === 'ArrowLeft')
      next = (index - 1 + codes.length) % codes.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = codes.length - 1
    if (next === null) return
    event.preventDefault()
    const code = codes[next]
    if (!code) return
    onSelect(code)
    listRef.current
      ?.querySelector<HTMLElement>(`[data-language="${code}"]`)
      ?.focus()
  }

  return (
    <div
      data-testid="language-bar"
      className={cn(
        'flex h-11 min-w-0 items-stretch gap-3 px-3 md:px-4',
        trailing && '@container',
      )}
      style={{ height: LANGUAGE_BAR_HEIGHT }}
    >
      <div
        ref={listRef}
        role="tablist"
        aria-label={m.editor_language_bar_label()}
        onKeyDown={onKeyDown}
        className="flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {summaries.map((summary) => {
          const selected = summary.locale === active
          const isThisMain = summary.locale === main
          // The tab shows the endonym; sentences in tooltips use the CMS language.
          const tabName = languageEndonym(summary.locale)
          const tip = languageTooltip(
            summary,
            uiLanguageName(summary.locale),
            fields,
          )
          return (
            <Hint
              key={summary.locale}
              label={
                <span className="grid gap-1.5">
                  <span>{tip}</span>
                  {summary.required ? (
                    <span className="text-text-muted">
                      {m.editor_language_required_hint()}
                    </span>
                  ) : null}
                  <span className="inline-flex items-center gap-2 text-text-muted">
                    {m.editor_language_switch_hint()}
                    <KbdCombo keys={['Ctrl', 'Shift', 'L']} />
                  </span>
                </span>
              }
            >
              <button
                type="button"
                role="tab"
                id={`language-tab-${summary.locale}`}
                aria-selected={selected}
                aria-label={tabName}
                tabIndex={selected ? 0 : -1}
                data-language={summary.locale}
                data-testid={`language-tab-${summary.locale}`}
                data-state={summary.state}
                data-required={summary.required ? 'true' : undefined}
                onClick={() => onSelect(summary.locale)}
                className={cn(
                  'relative flex shrink-0 items-center gap-1.5 rounded-[8px] px-2.5 text-[14px] leading-5 whitespace-nowrap outline-none transition-colors duration-150',
                  'focus-visible:ring-[3px] focus-visible:ring-accent-soft',
                  selected
                    ? 'font-semibold text-text-primary'
                    : 'font-medium text-text-secondary hover:bg-surface-state-hover hover:text-text-primary',
                )}
              >
                <LanguageRing
                  state={summary.state}
                  fraction={summary.fraction}
                  warning={summary.warning}
                />
                <span className="hidden sm:inline">{tabName}</span>
                <span className="font-mono text-[12px] sm:hidden">
                  {languageCode(summary.locale)}
                </span>
                {isThisMain ? (
                  <span className="text-[12px] leading-4 font-normal text-text-muted">
                    {m.editor_language_main()}
                  </span>
                ) : null}
                {selected ? (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-2 bottom-0 h-0.5"
                  >
                    {reduce ? (
                      <span className="block h-full w-full rounded-full bg-accent" />
                    ) : (
                      <motion.span
                        layoutId="language-bar-indicator"
                        transition={SPRING_SMALL}
                        className="block h-full w-full rounded-full bg-accent"
                      />
                    )}
                  </span>
                ) : null}
              </button>
            </Hint>
          )
        })}
      </div>
      {isMain ? null : (
        <p
          className={cn(
            'hidden shrink-0 items-center self-center text-[13px] leading-[18px] text-text-muted',
            // With the translate action, the hint needs room for both.
            trailing ? '@min-[52rem]:flex' : 'md:flex',
          )}
        >
          {m.editor_language_shared_hint()}
        </p>
      )}
      {trailing ? (
        <div className="flex shrink-0 items-center self-center">{trailing}</div>
      ) : null}
    </div>
  )
}
