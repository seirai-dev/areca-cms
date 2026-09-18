import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { OrgIdentityStrip } from '#/components/identity-strip'
import { m } from '#/paraglide/messages'

/**
 * Organization frame for owners (non-agency users): the org identity strip
 * with the Members / Activity tabs, which are separate routes. The links carry
 * `role="tab"` so they read (and test) like the agency tab row.
 */
export function OrgFrame({
  orgId,
  name,
  slug,
  active,
  children,
}: {
  orgId: string
  name: string
  slug?: string
  active: 'members' | 'audit'
  children: ReactNode
}) {
  const tabs = [
    { key: 'members', label: m.admin_members(), to: '/orgs/$orgId/members' },
    {
      key: 'audit',
      label: m.admin_audit_activity_title(),
      to: '/orgs/$orgId/audit',
    },
  ] as const

  return (
    <div data-testid="organization-page">
      <OrgIdentityStrip
        name={name}
        slug={slug}
        tabs={
          <div role="tablist" aria-label={name} className="flex gap-5">
            {tabs.map((tab) => (
              <Link
                key={tab.key}
                to={tab.to}
                params={{ orgId }}
                role="tab"
                aria-selected={active === tab.key}
                aria-current={active === tab.key ? 'page' : undefined}
                className="nav-tab h-11"
              >
                {tab.label}
              </Link>
            ))}
          </div>
        }
      />
      {children}
    </div>
  )
}
