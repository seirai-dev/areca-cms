import { useMutation, useQueryClient } from '@tanstack/react-query'

import { queryKeys } from '#/lib/query-keys'
import { useStepUp } from '#/features/security/step-up'
import { sendPasswordResetLinkFn } from '#/server/fn/account'
import {
  inviteMemberFn,
  regenerateInvitationLinkFn,
  resendInvitationFn,
  revokeInvitationFn,
  setAgencyAdminFn,
} from '#/server/fn/admin'
import {
  blockUserFn,
  bulkAddUsersToClientsFn,
  bulkBlockUsersFn,
  bulkSignOutUsersFn,
  bulkUnblockUsersFn,
  deleteUserFn,
  resetUserTwoFactorFn,
  setUserClientAccessFn,
  signOutUserEverywhereFn,
  unblockUserFn,
  updateUserNameFn,
} from '#/server/fn/people'
import type { AccessChange } from './person/access-stage'
import type { MembershipRole } from '#/lib/types'
import { resetAdminFactorLockoutFn } from '#/server/fn/security'

/**
 * Every write the People screens make. Actions that need a fresh agency-admin
 * check run through `stepUp.run`, so an expired check asks for a code once and
 * retries. Each success refreshes the people caches.
 */
export function usePeopleMutations() {
  const queryClient = useQueryClient()
  const stepUp = useStepUp()

  async function refreshPeople(userId?: string) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.users() }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.pendingInvitations(),
      }),
      queryClient.invalidateQueries({ queryKey: queryKeys.allInvitations() }),
      ...(userId
        ? [
            queryClient.invalidateQueries({
              queryKey: queryKeys.person(userId),
            }),
          ]
        : []),
    ])
  }

  const block = useMutation({
    mutationFn: (input: { userId: string; reason?: string }) =>
      stepUp.run(() => blockUserFn({ data: input })),
    onSettled: (_data, _error, input) => void refreshPeople(input.userId),
  })

  const unblock = useMutation({
    mutationFn: (userId: string) =>
      stepUp.run(() => unblockUserFn({ data: { userId } })),
    onSettled: (_data, _error, userId) => void refreshPeople(userId),
  })

  const remove = useMutation({
    mutationFn: (userId: string) =>
      stepUp.run(() => deleteUserFn({ data: { userId } })),
    onSettled: () => refreshPeople(),
  })

  const resetTwoFactor = useMutation({
    mutationFn: (userId: string) =>
      stepUp.run(() => resetUserTwoFactorFn({ data: { userId } })),
    onSettled: (_data, _error, userId) => void refreshPeople(userId),
  })

  const signOutEverywhere = useMutation({
    mutationFn: (userId: string) =>
      stepUp.run(() => signOutUserEverywhereFn({ data: { userId } })),
    onSettled: (_data, _error, userId) => void refreshPeople(userId),
  })

  const rename = useMutation({
    mutationFn: (input: { userId: string; name: string }) =>
      updateUserNameFn({ data: input }),
    onSettled: (_data, _error, input) => void refreshPeople(input.userId),
  })

  /** One staged save from the person's page. Not a fresh-admin action. */
  const saveAccess = useMutation({
    mutationFn: (input: { userId: string } & AccessChange) =>
      setUserClientAccessFn({ data: input }),
    onSettled: (_data, _error, input) => void refreshPeople(input.userId),
  })

  const setAgencyAdmin = useMutation({
    mutationFn: (input: { userId: string; isAgencyAdmin: boolean }) =>
      stepUp.run(() => setAgencyAdminFn({ data: input })),
    onSettled: (_data, _error, input) => void refreshPeople(input.userId),
  })

  const resetLockout = useMutation({
    mutationFn: (userId: string) =>
      stepUp.run(() => resetAdminFactorLockoutFn({ data: { userId } })),
    onSettled: () => refreshPeople(),
  })

  const sendResetLink = useMutation({
    mutationFn: (userId: string) =>
      sendPasswordResetLinkFn({ data: { userId } }),
  })

  const bulkBlock = useMutation({
    mutationFn: (input: { userIds: string[]; reason?: string }) =>
      stepUp.run(() => bulkBlockUsersFn({ data: input })),
    onSettled: () => refreshPeople(),
  })

  const bulkUnblock = useMutation({
    mutationFn: (userIds: string[]) =>
      stepUp.run(() => bulkUnblockUsersFn({ data: { userIds } })),
    onSettled: () => refreshPeople(),
  })

  const bulkSignOut = useMutation({
    mutationFn: (userIds: string[]) =>
      stepUp.run(() => bulkSignOutUsersFn({ data: { userIds } })),
    onSettled: () => refreshPeople(),
  })

  const bulkAddToClients = useMutation({
    mutationFn: (input: {
      userIds: string[]
      organizationIds: string[]
      role: MembershipRole
    }) => stepUp.run(() => bulkAddUsersToClientsFn({ data: input })),
    onSettled: () => refreshPeople(),
  })

  /** Invitations are per client; the caller sends one per client it picked. */
  const inviteToClient = useMutation({
    mutationFn: (input: {
      organizationId: string
      email: string
      role: MembershipRole
    }) => inviteMemberFn({ data: input }),
    onSettled: () => refreshPeople(),
  })

  const revokeInvitation = useMutation({
    mutationFn: (id: string) => revokeInvitationFn({ data: { id } }),
    onSettled: () => refreshPeople(),
  })

  const resendInvitation = useMutation({
    mutationFn: (id: string) => resendInvitationFn({ data: { id } }),
    onSettled: () => refreshPeople(),
  })

  const regenerateLink = useMutation({
    mutationFn: (id: string) => regenerateInvitationLinkFn({ data: { id } }),
    onSettled: () => refreshPeople(),
  })

  return {
    block,
    unblock,
    remove,
    resetTwoFactor,
    signOutEverywhere,
    rename,
    saveAccess,
    setAgencyAdmin,
    resetLockout,
    sendResetLink,
    bulkBlock,
    bulkUnblock,
    bulkSignOut,
    bulkAddToClients,
    inviteToClient,
    revokeInvitation,
    resendInvitation,
    regenerateLink,
  }
}
