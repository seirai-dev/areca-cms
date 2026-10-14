import { Link, useRouterState } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import type { CompanyInfoGlobal } from '../generated/content/areca.gen.ts'
import { Wordmark } from './brand.tsx'

const NAV = [
  { to: '/coffees', label: 'Coffees' },
  { to: '/journal', label: 'Journal' },
  { to: '/team', label: 'Team' },
  { to: '/about', label: 'About' },
] as const

const NAV_LINK =
  'relative py-1 text-sm text-muted transition-colors hover:text-ink after:absolute after:-bottom-0.5 after:left-0 after:h-px after:w-full after:origin-left after:scale-x-0 after:bg-accent-strong after:transition-transform after:duration-300 hover:after:scale-x-100'
const NAV_LINK_ACTIVE = 'text-ink after:scale-x-100'

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/80 backdrop-blur-md supports-[backdrop-filter]:bg-canvas/70">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-5 sm:px-8 md:h-20">
        <Wordmark />
        <nav aria-label="Main" className="hidden md:block">
          <ul className="flex items-center gap-9">
            {NAV.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className={NAV_LINK}
                  activeProps={{ className: `${NAV_LINK} ${NAV_LINK_ACTIVE}` }}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <MobileNav />
      </div>
    </header>
  )
}

/** Disclosure button with aria-expanded; the menu closes when the route changes. */
function MobileNav() {
  const [open, setOpen] = useState(false)
  const pathname = useRouterState({ select: (state) => state.location.pathname })

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="mobile-nav"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-sm font-medium text-ink transition-colors hover:border-ink"
      >
        {open ? 'Close' : 'Menu'}
        <span aria-hidden="true" className="relative block size-3.5">
          <span
            className={`absolute left-0 top-1/2 h-px w-full bg-current transition-transform duration-200 ${open ? 'rotate-45' : '-translate-y-1'}`}
          />
          <span
            className={`absolute left-0 top-1/2 h-px w-full bg-current transition-transform duration-200 ${open ? '-rotate-45' : 'translate-y-1'}`}
          />
        </span>
      </button>
      {open ? (
        <nav
          id="mobile-nav"
          aria-label="Main"
          className="absolute inset-x-0 top-full border-b border-line bg-canvas shadow-card"
        >
          <ul className="mx-auto max-w-6xl divide-y divide-line px-5 sm:px-8">
            {NAV.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className="flex items-center justify-between py-4 font-display text-2xl text-ink"
                  activeProps={{ className: 'flex items-center justify-between py-4 font-display text-2xl text-accent-strong' }}
                >
                  {item.label}
                  <span aria-hidden="true" className="text-muted">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </div>
  )
}

export function SiteFooter({ company }: { company: CompanyInfoGlobal }) {
  return (
    <footer className="bg-brand text-brand-ink">
      <div className="mx-auto grid max-w-6xl gap-12 px-5 py-16 sm:px-8 md:grid-cols-12 md:py-20">
        <div className="md:col-span-5">
          <Wordmark inverse />
          {company.tagline ? (
            <p className="mt-6 max-w-sm font-display text-2xl leading-snug text-brand-ink/90">
              {company.tagline}
            </p>
          ) : null}
        </div>
        <nav aria-label="Footer" className="md:col-span-3">
          <h2 className="text-[0.7rem] font-medium uppercase tracking-[0.18em] text-brand-ink/60">Explore</h2>
          <ul className="mt-4 space-y-3 text-sm">
            {NAV.map((item) => (
              <li key={item.to}>
                <Link to={item.to} className="underline decoration-brand-ink/30 underline-offset-4 transition-colors hover:decoration-brand-ink">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="md:col-span-4">
          <h2 className="text-[0.7rem] font-medium uppercase tracking-[0.18em] text-brand-ink/60">Roastery</h2>
          <address className="mt-4 space-y-1 not-italic text-sm leading-7">
            <span className="block">{company.name}</span>
            {company.address ? <span className="block whitespace-pre-line">{company.address}</span> : null}
            {company.email ? (
              <a href={`mailto:${company.email}`} className="block underline decoration-brand-ink/30 underline-offset-4 transition-colors hover:decoration-brand-ink">
                {company.email}
              </a>
            ) : null}
            {company.phone ? (
              <a href={`tel:${company.phone.replace(/\s+/g, '')}`} className="block underline decoration-brand-ink/30 underline-offset-4 transition-colors hover:decoration-brand-ink">
                {company.phone}
              </a>
            ) : null}
            {company.instagramUrl ? (
              <a
                href={company.instagramUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block underline decoration-brand-ink/30 underline-offset-4 transition-colors hover:decoration-brand-ink"
              >
                Instagram
              </a>
            ) : null}
          </address>
        </div>
      </div>
      <div className="border-t border-brand-ink/15">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-6 text-xs text-brand-ink/70 sm:flex-row sm:justify-between sm:px-8">
          <p>
            © {new Date().getUTCFullYear()} {company.name}
          </p>
          <p>
            Content managed in Areca CMS and prerendered at build time — no requests to the CMS at runtime.
          </p>
        </div>
      </div>
    </footer>
  )
}
