import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useRouterState,
} from '@tanstack/react-router'

import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/_app/admin')({
  beforeLoad: ({ context }) => {
    if (!context.me.user.isAgencyAdmin) {
      throw redirect({ to: '/' })
    }
  },
  component: AdminLayout,
})

const SECTIONS = [
  {
    key: 'organizations',
    to: '/admin/organizations',
    label: () => m.shell_nav_organizations(),
  },
  { key: 'users', to: '/admin/users', label: () => m.shell_nav_users() },
  {
    key: 'audit',
    to: '/admin/audit',
    label: () => m.shell_nav_audit_log(),
    testId: 'audit-log',
  },
  {
    key: 'branding',
    to: '/admin/branding',
    label: () => m.shell_nav_branding(),
    testId: 'branding-nav',
  },
] as const

/**
 * Agency frame: a sticky anchor rail on the left (the same style as the
 * settings pages) and the agency page on the right.
 */
function AdminLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  return (
    <div className="grid gap-8 lg:grid-cols-[11rem_minmax(0,1fr)]">
      <nav
        aria-label={m.admin_agency_sections()}
        className="hidden self-start lg:sticky lg:top-[calc(var(--navbar-height)+1.5rem)] lg:block"
      >
        <ul className="grid gap-0.5 border-l border-border-subtle">
          {SECTIONS.map((section) => {
            const active = pathname.startsWith(section.to)
            return (
              <li key={section.key}>
                <Link
                  to={section.to}
                  data-testid={'testId' in section ? section.testId : undefined}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    '-ml-px block border-l py-1 pl-3 text-ds-label-md transition-colors',
                    active
                      ? 'border-action-primary text-text-primary'
                      : 'border-transparent text-text-muted hover:border-action-primary hover:text-text-primary',
                  )}
                >
                  {section.label()}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  )
}
