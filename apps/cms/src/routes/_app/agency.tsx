import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'

/** The Agency workspace (agency admins only, brief §3.11). */
export const Route = createFileRoute('/_app/agency')({
  beforeLoad: ({ context }) => {
    if (!context.me.user.isAgencyAdmin) {
      throw redirect({ to: '/' })
    }
  },
  component: Outlet,
})
