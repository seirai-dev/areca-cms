import { createFileRoute, redirect } from '@tanstack/react-router'

/** Legacy: `/admin` → the Agency workspace. */
export const Route = createFileRoute('/_app/admin/')({
  beforeLoad: () => {
    throw redirect({ to: '/agency', replace: true })
  },
})
