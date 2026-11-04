import { useState } from 'react'
import { GithubLogo, List, X } from '@phosphor-icons/react'
import { m } from '@/paraglide/messages'
import { links } from '@/lib/links'
import { Logo } from '../logo'
import { ThemeToggle } from '../theme-toggle'
import { Container } from '../ui'

const anchors = [
  { href: '#how', label: () => m.nav_how() },
  { href: '#features', label: () => m.nav_features() },
  { href: '#developers', label: () => m.nav_developers() },
  { href: '#self-host', label: () => m.nav_self_host() },
]

export function Nav() {
  const [open, setOpen] = useState(false)
  return (
    <header className="sticky top-0 z-40 border-b border-line/60 bg-bg/80 backdrop-blur-xl">
      <Container className="flex h-16 items-center justify-between gap-6">
        <a href="/" aria-label={m.logo_label()} className="rounded-lg">
          <Logo />
        </a>
        <nav
          aria-label={m.nav_label()}
          className="hidden items-center gap-1 md:flex"
        >
          {anchors.map((a) => (
            <a
              key={a.href}
              href={a.href}
              className="rounded-full px-3 py-1.5 text-small text-muted transition-colors hover:text-fg"
            >
              {a.label()}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-1.5">
          <a
            href={links.docs}
            className="hidden rounded-full px-3 py-1.5 text-small font-medium text-fg transition-colors hover:bg-raised sm:inline-flex"
          >
            {m.nav_docs()}
          </a>
          <a
            href={links.github}
            target="_blank"
            rel="noreferrer"
            className="hidden items-center gap-1.5 rounded-full border border-line-strong px-3 py-1.5 text-small font-medium transition-colors hover:bg-raised sm:inline-flex"
          >
            <GithubLogo size={16} weight="fill" />
            {m.nav_github()}
          </a>
          <ThemeToggle />
          <button
            type="button"
            className="grid size-9 place-items-center rounded-full text-muted hover:bg-raised hover:text-fg md:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? m.nav_menu_close() : m.nav_menu_open()}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X size={18} /> : <List size={18} />}
          </button>
        </div>
      </Container>
      {open ? (
        <nav
          id="mobile-nav"
          aria-label={m.nav_label()}
          className="border-t border-line md:hidden"
        >
          <Container className="grid gap-1 py-3">
            {[
              ...anchors,
              { href: links.docs, label: () => m.nav_docs() },
              { href: links.github, label: () => m.nav_github() },
            ].map((a) => (
              <a
                key={a.href}
                href={a.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-2.5 text-body text-fg"
              >
                {a.label()}
              </a>
            ))}
          </Container>
        </nav>
      ) : null}
    </header>
  )
}
