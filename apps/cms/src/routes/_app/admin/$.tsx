import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * Legacy: `/admin/*` → `/agency/*` (brief §2): organizations → clients,
 * users → people, audit → activity, branding → branding.
 */
export const Route = createFileRoute('/_app/admin/$')({
  beforeLoad: ({ params }) => {
    const [section, id] = (params._splat ?? '').split('/').filter(Boolean)
    if (section === 'organizations' && id) {
      throw redirect({
        to: '/agency/clients/$orgId',
        params: { orgId: id },
        replace: true,
      })
    }
    if (section === 'organizations') {
      throw redirect({ to: '/agency/clients', replace: true })
    }
    if (section === 'users')
      throw redirect({ to: '/agency/people', replace: true })
    if (section === 'audit')
      throw redirect({ to: '/agency/activity', replace: true })
    if (section === 'branding') {
      throw redirect({ to: '/agency/branding', replace: true })
    }
    throw redirect({ to: '/agency', replace: true })
  },
})
