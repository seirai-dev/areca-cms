import { Link } from '@tanstack/react-router'

import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

/**
 * The account pages' nav: Account (profile, notifications, two-factor) and
 * Sessions. One row of links under the page header, current page marked.
 */
export function AccountNav({ current }: { current: 'account' | 'sessions' }) {
  const links = [
    { key: 'account', to: '/account', label: m.account_nav_account() },
    {
      key: 'sessions',
      to: '/account/sessions',
      label: m.account_nav_sessions(),
    },
  ] as const
  return (
    <nav
      aria-label={m.account_nav_label()}
      className="flex gap-1 border-b border-border-default"
      data-testid="account-nav"
    >
      {links.map((link) => {
        const active = link.key === current
        return (
          <Link
            key={link.key}
            to={link.to}
            aria-current={active ? 'page' : undefined}
            data-testid={`account-nav-${link.key}`}
            className={cn(
              '-mb-px border-b-2 px-3 pt-1 pb-2.5 text-[14px] leading-5 font-medium outline-none focus-visible:outline-2 focus-visible:outline-border-focus',
              active
                ? 'border-accent text-text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary',
            )}
          >
            {link.label}
          </Link>
        )
      })}
    </nav>
  )
}
