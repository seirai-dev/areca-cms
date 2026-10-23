/**
 * What the person page can and cannot do to one person, from the people list
 * the page already has. The server enforces the same rules; these decide
 * which controls are disabled and why.
 */

export type PersonFactsAccount = {
  id: string
  status: 'active' | 'blocked'
  isAgencyAdmin: boolean
}

/** Agency admins who are not blocked. Blocked admins do not count. */
export function activeAdminCount(accounts: PersonFactsAccount[]) {
  return accounts.filter(
    (account) => account.isAgencyAdmin && account.status === 'active',
  ).length
}

/**
 * True when this person is the only active agency admin: they cannot be
 * blocked, deleted or stripped of the admin role until someone else is one.
 */
export function isLastActiveAdmin(
  accounts: PersonFactsAccount[],
  userId: string,
) {
  const target = accounts.find((account) => account.id === userId)
  if (!target || target.status !== 'active' || !target.isAgencyAdmin) {
    return false
  }
  return activeAdminCount(accounts) <= 1
}
