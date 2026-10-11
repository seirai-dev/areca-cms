import { Link } from '@tanstack/react-router'
import { SITE_NAME } from '../lib/seo.ts'

/** North-pointing peak: the Northbound mark, drawn in currentColor. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M16 2 26.5 28.5 16 22 5.5 28.5Z" fill="currentColor" />
    </svg>
  )
}

/** Logo and wordmark, linked to the home page. "inverse" is for the pine footer. */
export function Wordmark({ inverse = false }: { inverse?: boolean }) {
  return (
    <Link
      to="/"
      aria-label={`${SITE_NAME} home`}
      className={`group flex items-center gap-2.5 rounded-md ${inverse ? "text-brand-ink" : "text-primary"}`}
    >
      <LogoMark className="size-7 transition-transform duration-300 group-hover:-rotate-6" />
      <span className="flex flex-col leading-none">
        <span className={`font-display text-[1.35rem] font-semibold tracking-tight ${inverse ? "text-brand-ink" : "text-ink"}`}>
          Northbound
        </span>
        <span className={`mt-1 text-[0.6rem] font-medium tracking-[0.28em] ${inverse ? "text-brand-ink/70" : "text-muted"}`}>
          COFFEE CO.
        </span>
      </span>
    </Link>
  )
}
