import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/admin')({
  beforeLoad: ({ context }) => {
    if (!context.me?.user.isAgencyAdmin) {
      throw redirect({ to: '/' })
    }
  },
  component: AdminLayout,
})

function AdminLayout() {
  return <Outlet />
}
