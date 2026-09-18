import { createFileRoute, redirect } from '@tanstack/react-router'

/** The site list lives on the home page now; old links land there. */
export const Route = createFileRoute('/_app/sites/')({
  beforeLoad: () => {
    throw redirect({ to: '/' })
  },
})
