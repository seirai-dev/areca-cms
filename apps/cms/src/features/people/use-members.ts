import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'

import { adminQueryKeys, errorMessage } from '#/components/admin/helpers'
import type { MembershipRole } from '#/lib/types'
import { getLocale } from '#/paraglide/runtime'
import { m } from '#/paraglide/messages'
import {
  inviteMemberFn,
  listInvitationsFn,
  listMembersFn,
  removeMemberFn,
  revokeInvitationFn,
  updateMemberRoleFn,
} from '#/server/fn/admin'

export type MemberRow = Awaited<ReturnType<typeof listMembersFn>>[number]
export type InvitationRow = Awaited<
  ReturnType<typeof listInvitationsFn>
>[number]

export type InviteResult = { email: string; ok: boolean; error?: string }

const DAY = 86_400_000
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/

/** "a@x.com, b@y.com;c@z.com" → unique, trimmed, lower-cased list. */
export function parseEmails(input: string) {
  const seen = new Set<string>()
  const emails: string[] = []
  for (const raw of input.split(/[\s,;]+/)) {
    const email = raw.trim()
    if (!email) continue
    const key = email.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    emails.push(email)
  }
  return emails
}

export function isValidEmail(email: string) {
  return EMAIL.test(email)
}

export function isInvitationExpired(
  invitation: { expiresAt: Date | string },
  now = Date.now(),
) {
  const expires = new Date(invitation.expiresAt).getTime()
  return !Number.isNaN(expires) && expires <= now
}

/** "in 5 days", "tomorrow", "in 3 hours" for a future expiry. */
export function expiresInLabel(expiresAt: Date | string, now = Date.now()) {
  const diff = new Date(expiresAt).getTime() - now
  const rtf = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' })
  if (diff >= DAY) return rtf.format(Math.round(diff / DAY), 'day')
  return rtf.format(Math.max(1, Math.round(diff / 3_600_000)), 'hour')
}

export function roleChangedMessage(role: MembershipRole) {
  return role === 'owner'
    ? m.admin_members_toast_role_changed_owner()
    : m.admin_members_toast_role_changed_editor()
}

/**
 * Members and invitations of one client (organization), with every mutation
 * the People screen needs. Owners and agency admins only (the server checks).
 */
export function useMembers(organizationId: string) {
  const queryClient = useQueryClient()
  const listMembers = useServerFn(listMembersFn)
  const listInvitations = useServerFn(listInvitationsFn)
  const updateMemberRole = useServerFn(updateMemberRoleFn)
  const removeMember = useServerFn(removeMemberFn)
  const inviteMember = useServerFn(inviteMemberFn)
  const revokeInvitation = useServerFn(revokeInvitationFn)

  const members = useQuery({
    queryKey: adminQueryKeys.members(organizationId),
    queryFn: () => listMembers({ data: { organizationId } }),
  })
  const invitations = useQuery({
    queryKey: adminQueryKeys.invitations(organizationId),
    queryFn: () => listInvitations({ data: { organizationId } }),
  })

  const refreshMembers = React.useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: adminQueryKeys.members(organizationId),
      }),
    [queryClient, organizationId],
  )
  const refreshInvitations = React.useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: adminQueryKeys.invitations(organizationId),
      }),
    [queryClient, organizationId],
  )

  const changeRole = useMutation({
    mutationFn: (input: { userId: string; role: MembershipRole }) =>
      updateMemberRole({
        data: { organizationId, userId: input.userId, role: input.role },
      }),
    onSettled: refreshMembers,
  })

  const remove = useMutation({
    mutationFn: (userId: string) =>
      removeMember({ data: { organizationId, userId } }),
    onSettled: refreshMembers,
  })

  const revoke = useMutation({
    mutationFn: (id: string) => revokeInvitation({ data: { id } }),
    onSettled: refreshInvitations,
  })

  /** Sends invitations one after another and reports per address. */
  const invite = useMutation({
    mutationFn: async (input: {
      emails: string[]
      role: MembershipRole
      onProgress?: (index: number) => void
    }) => {
      const results: InviteResult[] = []
      for (const [index, email] of input.emails.entries()) {
        input.onProgress?.(index)
        try {
          await inviteMember({
            data: { organizationId, email, role: input.role },
          })
          results.push({ email, ok: true })
        } catch (error) {
          results.push({ email, ok: false, error: errorMessage(error) })
        }
      }
      return results
    },
    onSettled: refreshInvitations,
  })

  /** Re-invite an expired address, then drop the stale row. */
  const resend = useMutation({
    mutationFn: async (row: InvitationRow) => {
      await inviteMember({
        data: { organizationId, email: row.email, role: row.role },
      })
      await revokeInvitation({ data: { id: row.id } }).catch(() => undefined)
    },
    onSettled: refreshInvitations,
  })

  const sortedMembers = React.useMemo(
    () =>
      [...(members.data ?? [])].sort((a, b) =>
        (a.name || a.email).localeCompare(b.name || b.email),
      ),
    [members.data],
  )

  /** Open invitations only (accepted ones are hidden), newest first. */
  const openInvitations = React.useMemo(
    () =>
      (invitations.data ?? [])
        .filter((row) => !row.acceptedAt)
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        ),
    [invitations.data],
  )

  return {
    members,
    invitations,
    sortedMembers,
    openInvitations,
    changeRole,
    remove,
    revoke,
    invite,
    resend,
  }
}
