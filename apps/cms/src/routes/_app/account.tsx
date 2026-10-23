import { Outlet, createFileRoute } from '@tanstack/react-router'

/** `/account` and its pages: the profile page and `/account/sessions`. */
export const Route = createFileRoute('/_app/account')({
  component: AccountLayout,
})

function AccountLayout() {
  return <Outlet />
}
