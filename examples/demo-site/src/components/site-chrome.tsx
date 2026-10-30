import { Link, useMatches, useRouterState } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { m } from '#/paraglide/messages'
import type { CompanyInfoGlobal } from '../generated/content/areca.gen.ts'
import { LOCALES, pageAlternates, currentLocale } from '../lib/i18n.ts'
import type { Alternates, Locale } from '../lib/i18n.ts'
import { useField } from '../lib/visual-markers.tsx'
import { Wordmark } from './brand.tsx'

/** Main navigation. Labels are read when rendered so they follow the active language. */
function navItems() {
  return [
    { to: '/coffees', label: m.nav_coffees() },
    { to: '/journal', label: m.nav_journal() },
    { to: '/team', label: m.nav_team() },
    { to: '/about', label: m.nav_about() },
  ] as const
}

const NAV_LINK =
  'relative py-1 text-sm text-muted transition-colors hover:text-ink after:absolute after:-bottom-0.5 after:left-0 after:h-px after:w-full after:origin-left after:scale-x-0 after:bg-accent-strong after:transition-transform after:duration-300 hover:after:scale-x-100'
const NAV_LINK_ACTIVE = 'text-ink after:scale-x-100'

export function SiteHeader() {
  const nav = navItems()
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/80 backdrop-blur-md supports-[backdrop-filter]:bg-canvas/70">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-5 sm:px-8 md:h-20">
        <Wordmark />
        <nav aria-label={m.main_nav_label()} className="hidden md:block">
          <ul className="flex items-center gap-9">
            {nav.map((item) => (
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
        <div className="flex items-center gap-4">
          <LanguageSwitcher />
          <MobileNav />
        </div>
      </div>
    </header>
  )
}

/** The page's alternates from the innermost route that provides them (entry pages do). */
function currentAlternates(matches: ReadonlyArray<{ loaderData?: unknown }>): Alternates | undefined {
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const alternates = (matches[index]?.loaderData as { alternates?: Alternates } | undefined)?.alternates
    if (alternates) return alternates
  }
  return undefined
}

/**
 * One link per language to the same page. Entry pages link to the entry's
 * translation (its own slug and path); when there is none, to the home page.
 * Other pages link to the same path in that language. A plain link: the other
 * language is a different prerendered document.
 */
function LanguageSwitcher() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const entry = useMatches({ select: currentAlternates })
  const current = currentLocale()

  return (
    <nav aria-label={m.language_label()}>
      <ul className="flex items-center gap-1 text-xs font-medium uppercase tracking-[0.12em]">
        {LOCALES.map((locale) => (
          <li key={locale}>
            <LanguageLink
              locale={locale}
              current={current}
              href={targetFor(locale, pathname, entry)}
            />
          </li>
        ))}
      </ul>
    </nav>
  )
}

function targetFor(locale: Locale, pathname: string, entry: Alternates | undefined): string {
  if (entry) return entry[locale] ?? pageAlternates('/')[locale]
  return pageAlternates(pathname)[locale]
}

function LanguageLink({ locale, current, href }: { locale: Locale; current: Locale; href: string }) {
  const name = locale === 'nl' ? m.language_name_nl() : m.language_name_en()
  if (locale === current) {
    return (
      <span aria-current="true" lang={locale} className="rounded-full px-3 py-1.5 text-ink ring-1 ring-inset ring-line">
        {locale}
        <span className="sr-only"> ({name})</span>
      </span>
    )
  }
  return (
    <a
      href={href}
      hrefLang={locale}
      lang={locale}
      className="rounded-full px-3 py-1.5 text-muted transition-colors hover:text-ink"
      title={name}
    >
      {locale}
      <span className="sr-only"> ({name})</span>
    </a>
  )
}

/** Disclosure button with aria-expanded; the menu closes when the route changes. */
function MobileNav() {
  const [open, setOpen] = useState(false)
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const nav = navItems()

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
        {open ? m.menu_close() : m.menu_open()}
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
          aria-label={m.main_nav_label()}
          className="absolute inset-x-0 top-full border-b border-line bg-canvas shadow-card"
        >
          <ul className="mx-auto max-w-6xl divide-y divide-line px-5 sm:px-8">
            {nav.map((item) => (
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

/** Company details; only the name is guaranteed, the rest is shown when set. Fields belong to the `companyInfo` section. */
export function SiteFooter({ company }: { company: Partial<CompanyInfoGlobal> & { name: string } }) {
  const nav = navItems()
  const field = useField()
  const owner = { global: 'companyInfo' }
  return (
    <footer className="bg-brand text-brand-ink">
      <div className="mx-auto grid max-w-6xl gap-12 px-5 py-16 sm:px-8 md:grid-cols-12 md:py-20">
        <div className="md:col-span-5">
          <Wordmark inverse />
          {company.tagline ? (
            <p {...field('tagline', owner)} className="mt-6 max-w-sm font-display text-2xl leading-snug text-brand-ink/90">
              {company.tagline}
            </p>
          ) : null}
        </div>
        <nav aria-label={m.footer_nav_label()} className="md:col-span-3">
          <h2 className="text-[0.7rem] font-medium uppercase tracking-[0.18em] text-brand-ink/60">{m.footer_explore()}</h2>
          <ul className="mt-4 space-y-3 text-sm">
            {nav.map((item) => (
              <li key={item.to}>
                <Link to={item.to} className="underline decoration-brand-ink/30 underline-offset-4 transition-colors hover:decoration-brand-ink">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="md:col-span-4">
          <h2 className="text-[0.7rem] font-medium uppercase tracking-[0.18em] text-brand-ink/60">{m.footer_roastery()}</h2>
          <address className="mt-4 space-y-1 not-italic text-sm leading-7">
            <span {...field('name', owner)} className="block">{company.name}</span>
            {company.address ? (
              <span {...field('address', owner)} className="block whitespace-pre-line">{company.address}</span>
            ) : null}
            {company.email ? (
              <a
                {...field('email', owner)}
                href={`mailto:${company.email}`}
                className="block underline decoration-brand-ink/30 underline-offset-4 transition-colors hover:decoration-brand-ink"
              >
                {company.email}
              </a>
            ) : null}
            {company.phone ? (
              <a
                {...field('phone', owner)}
                href={`tel:${company.phone.replace(/\s+/g, '')}`}
                className="block underline decoration-brand-ink/30 underline-offset-4 transition-colors hover:decoration-brand-ink"
              >
                {company.phone}
              </a>
            ) : null}
            {company.instagramUrl ? (
              <a
                {...field('instagramUrl', owner)}
                href={company.instagramUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block underline decoration-brand-ink/30 underline-offset-4 transition-colors hover:decoration-brand-ink"
              >
                {m.footer_instagram()}
              </a>
            ) : null}
          </address>
        </div>
      </div>
      <div className="border-t border-brand-ink/15">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-6 text-xs text-brand-ink/70 sm:flex-row sm:justify-between sm:px-8">
          <p>
            © {new Date().getUTCFullYear()} <span {...field('name', owner)}>{company.name}</span>
          </p>
          <p>{m.footer_content_note()}</p>
        </div>
      </div>
    </footer>
  )
}
