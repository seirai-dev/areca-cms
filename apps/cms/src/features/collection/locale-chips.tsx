import { Hint } from '#/components/ui/tooltip'
import { uiLanguageName } from '#/lib/site-languages'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

import type {
  CoverageState,
  LocaleCoverage,
} from '#/lib/content/entry-coverage'

/**
 * One small chip per site language on an entry row or card (brief: coverage
 * chips). Complete: filled. Partial: warning tone when the language is
 * required, neutral otherwise, with a half-filled dot. Empty: dashed outline.
 * Only rendered on multilingual sites.
 */
export function LocaleChips({ coverage }: { coverage: LocaleCoverage[] }) {
  return (
    <span
      role="group"
      aria-label={m.coverage_group_label()}
      className="inline-flex flex-wrap items-center gap-1"
      data-testid="locale-chips"
    >
      {coverage.map((item) => (
        <Hint key={item.locale} label={coverageLabel(item)}>
          <span
            tabIndex={0}
            aria-label={coverageLabel(item)}
            data-testid={`locale-chip-${item.locale}`}
            data-state={item.state}
            data-required={item.required ? 'true' : undefined}
            className={cn(
              'inline-flex h-[18px] items-center gap-1 rounded-[6px] px-1.5 text-[11px] leading-none font-medium outline-none focus-visible:outline-2 focus-visible:outline-border-focus',
              chipTone(item),
            )}
          >
            {item.state === 'partial' ? (
              <span
                aria-hidden="true"
                className="size-[7px] rounded-full border border-current bg-[linear-gradient(90deg,currentColor_50%,transparent_50%)]"
              />
            ) : null}
            {item.locale.toUpperCase()}
          </span>
        </Hint>
      ))}
    </span>
  )
}

function chipTone(item: LocaleCoverage): string {
  switch (item.state) {
    case 'complete':
      return 'bg-background-subtle text-text-secondary'
    case 'partial':
      return item.required
        ? 'bg-status-warning-bg text-text-warning'
        : 'bg-background-subtle text-text-secondary'
    case 'empty':
      return 'border border-dashed border-border-strong bg-transparent text-text-muted'
  }
}

/** "English: 2 missing", "English: complete", "English: not started". */
export function coverageLabel(item: LocaleCoverage): string {
  const language = uiLanguageName(item.locale)
  return coverageText(item.state, language, item.missing)
}

function coverageText(state: CoverageState, language: string, missing: number) {
  if (state === 'complete') return m.coverage_complete({ language })
  if (state === 'empty') return m.coverage_empty({ language })
  return missing === 1
    ? m.coverage_missing_one({ language })
    : m.coverage_missing_other({ language, count: missing })
}
