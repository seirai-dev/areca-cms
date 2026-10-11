import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { formatLabel } from './formatters.ts'

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-medium tracking-wide transition-colors duration-200'

export const buttonPrimary = `${BUTTON_BASE} bg-primary text-on-primary hover:bg-accent-strong hover:text-on-accent`

export const buttonSecondary = `${BUTTON_BASE} border border-current text-ink hover:bg-ink hover:text-canvas`

export const buttonOnImage = `${BUTTON_BASE} bg-on-image text-brand hover:bg-accent hover:text-on-accent`

export const buttonGhostOnImage = `${BUTTON_BASE} border border-on-image/60 text-on-image hover:border-on-image hover:bg-on-image/10`

/** Small caps line above headings, e.g. "ORIGIN · PROCESS". */
export function Eyebrow({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <p
      className={`text-[0.72rem] font-medium uppercase tracking-[0.18em] text-muted ${className}`}
    >
      {children}
    </p>
  )
}

/** Pill naming an article category. */
export function CategoryPill({ category }: { category: string | null }) {
  const label = formatLabel(category)
  if (!label) return null
  return (
    <span className="inline-flex items-center rounded-full border border-fjord/30 px-3 py-1 text-[0.7rem] font-medium uppercase tracking-[0.14em] text-fjord">
      {label}
    </span>
  )
}

/** Four-step dot scale for roast level; announced as one label. */
export function RoastScale({
  level,
  className = '',
}: {
  level: string | null
  className?: string
}) {
  const steps = ['light', 'medium', 'medium-dark', 'dark']
  const index = level ? steps.indexOf(level) : -1
  const label = formatLabel(level)
  if (!label || index < 0) return null
  return (
    <span
      role="img"
      aria-label={`Roast level ${label.toLowerCase()}, step ${index + 1} of 4`}
      className={`inline-flex items-center gap-2.5 text-sm text-ink ${className}`}
    >
      <span className="inline-flex items-center gap-1" aria-hidden="true">
        {steps.map((step, i) => (
          <span
            key={step}
            className={`size-2 rounded-full ${i <= index ? 'bg-primary' : 'bg-line ring-1 ring-inset ring-line'}`}
          />
        ))}
      </span>
      <span>{label} roast</span>
    </span>
  )
}

export function TastingChips({
  notes,
  className = '',
}: {
  notes: string[]
  className?: string
}) {
  if (!notes.length) return null
  return (
    <ul className={`flex flex-wrap gap-2 ${className}`}>
      {notes.map((note) => (
        <li
          key={note}
          className="rounded-full bg-surface px-3 py-1 text-xs text-ink ring-1 ring-inset ring-line"
        >
          {note}
        </li>
      ))}
    </ul>
  )
}

/** Section title row with an optional text link on the right. */
export function SectionHeading({
  id,
  eyebrow,
  title,
  linkTo,
  linkLabel,
}: {
  id: string
  eyebrow?: string
  title: string
  linkTo?: '/coffees' | '/journal' | '/team'
  linkLabel?: string
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
      <div>
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <h2 id={id} className="mt-2 font-display text-3xl font-normal tracking-tight text-ink md:text-4xl">
          {title}
        </h2>
      </div>
      {linkTo && linkLabel ? (
        <Link
          to={linkTo}
          className="group text-sm font-medium text-ink underline decoration-line underline-offset-[6px] transition-colors hover:text-accent-strong hover:decoration-accent-strong"
        >
          {linkLabel} <span aria-hidden="true" className="inline-block transition-transform group-hover:translate-x-0.5">→</span>
        </Link>
      ) : null}
    </div>
  )
}
