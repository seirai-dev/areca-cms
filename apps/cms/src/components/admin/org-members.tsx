import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { toast } from 'sonner'

import { ConfirmDialog } from '#/components/ui/confirm-dialog'
import { createDataColumns, DataTable } from '#/components/data-table'
import { EmptyState } from '#/components/ui/empty-state'
import { FormField } from '#/components/ui/form-field'
import { QueryError } from '#/components/ui/query-error'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import type { MembershipRole } from '#/lib/types'
import { m } from '#/paraglide/messages'
import {
  inviteMemberFn,
  listInvitationsFn,
  listMembersFn,
  removeMemberFn,
  revokeInvitationFn,
  updateMemberRoleFn,
} from '#/server/fn/admin'

import {
  adminQueryKeys,
  errorMessage,
  formatDate,
  membershipRoleLabel,
  membershipRoleOptionLabel,
} from './helpers'
import { TableSkeleton } from './table-skeleton'
import { EnvelopeSimple, UserPlus, Users } from '@phosphor-icons/react'

type MemberRow = Awaited<ReturnType<typeof listMembersFn>>[number]
type InvitationRow = Awaited<ReturnType<typeof listInvitationsFn>>[number]

const memberHelper = createDataColumns<MemberRow>()
const invitationHelper = createDataColumns<InvitationRow>()

function isExpired(invitation: InvitationRow) {
  const expires = new Date(invitation.expiresAt)
  return !Number.isNaN(expires.getTime()) && expires.getTime() < Date.now()
}

function roleChangedToast(role: MembershipRole) {
  return role === 'owner'
    ? m.admin_members_toast_role_changed_owner()
    : m.admin_members_toast_role_changed_editor()
}

export function OrgMembers({ organizationId }: { organizationId: string }) {
  const queryClient = useQueryClient()
  const listMembers = useServerFn(listMembersFn)
  const listInvitations = useServerFn(listInvitationsFn)
  const updateMemberRole = useServerFn(updateMemberRoleFn)
  const removeMember = useServerFn(removeMemberFn)
  const inviteMember = useServerFn(inviteMemberFn)
  const revokeInvitation = useServerFn(revokeInvitationFn)

  const [inviteOpen, setInviteOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<MembershipRole>('editor')

  const membersQuery = useQuery({
    queryKey: adminQueryKeys.members(organizationId),
    queryFn: () => listMembers({ data: { organizationId } }),
  })
  const invitationsQuery = useQuery({
    queryKey: adminQueryKeys.invitations(organizationId),
    queryFn: () => listInvitations({ data: { organizationId } }),
  })

  const roleMutation = useMutation({
    mutationFn: (input: { userId: string; role: MembershipRole }) =>
      updateMemberRole({
        data: { organizationId, userId: input.userId, role: input.role },
      }),
    onSuccess: async (_result, input) => {
      toast.success(roleChangedToast(input.role))
      await queryClient.invalidateQueries({
        queryKey: adminQueryKeys.members(organizationId),
      })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const removeMutation = useMutation({
    mutationFn: (userId: string) =>
      removeMember({ data: { organizationId, userId } }),
    onSuccess: async () => {
      toast.success(m.admin_members_toast_removed())
      await queryClient.invalidateQueries({
        queryKey: adminQueryKeys.members(organizationId),
      })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const inviteMutation = useMutation({
    mutationFn: () =>
      inviteMember({ data: { organizationId, email: email.trim(), role } }),
    onSuccess: async () => {
      toast.success(m.admin_members_toast_invited())
      setInviteOpen(false)
      setEmail('')
      setRole('editor')
      await queryClient.invalidateQueries({
        queryKey: adminQueryKeys.invitations(organizationId),
      })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeInvitation({ data: { id } }),
    onSuccess: async () => {
      toast.success(m.admin_members_toast_revoked())
      await queryClient.invalidateQueries({
        queryKey: adminQueryKeys.invitations(organizationId),
      })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const pendingInvitations = useMemo(
    () =>
      (invitationsQuery.data ?? []).filter(
        (invitation) => !invitation.acceptedAt,
      ),
    [invitationsQuery.data],
  )

  const memberColumns = useMemo(
    () =>
      memberHelper.columns([
        memberHelper.accessor('name', {
          header: () => m.admin_name(),
          cell: ({ row }) => (
            <span className="font-medium">{row.original.name}</span>
          ),
        }),
        memberHelper.accessor('email', {
          header: () => m.admin_email(),
          cell: ({ row }) => (
            <span className="text-muted-foreground">{row.original.email}</span>
          ),
        }),
        memberHelper.accessor('role', {
          header: () => m.admin_role(),
          cell: ({ row }) => {
            const member = row.original
            const busy =
              roleMutation.isPending &&
              roleMutation.variables.userId === member.userId
            return (
              <Select
                value={member.role}
                disabled={busy}
                onValueChange={(value) =>
                  roleMutation.mutate({
                    userId: member.userId,
                    role: value as MembershipRole,
                  })
                }
              >
                <SelectTrigger
                  className="w-32"
                  aria-label={m.admin_members_aria_role({
                    email: member.email,
                  })}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner">
                    {membershipRoleOptionLabel('owner')}
                  </SelectItem>
                  <SelectItem value="editor">
                    {membershipRoleOptionLabel('editor')}
                  </SelectItem>
                </SelectContent>
              </Select>
            )
          },
        }),
        memberHelper.accessor('createdAt', {
          header: () => m.admin_members_col_joined(),
          sortFn: 'datetime',
          cell: ({ row }) => (
            <span className="whitespace-nowrap text-muted-foreground">
              {formatDate(row.original.createdAt)}
            </span>
          ),
        }),
        memberHelper.display({
          id: 'actions',
          header: () => <span className="sr-only">{m.admin_actions()}</span>,
          enableSorting: false,
          cell: ({ row }) => {
            const member = row.original
            return (
              <div className="flex justify-end">
                <ConfirmDialog
                  title={m.admin_members_remove_title({ name: member.name })}
                  description={m.admin_members_remove_description({
                    email: member.email,
                  })}
                  confirmLabel={m.admin_members_remove_label()}
                  variant="destructive"
                  onConfirm={async () => {
                    await removeMutation.mutateAsync(member.userId)
                  }}
                >
                  <Button type="button" variant="ghost" size="sm">
                    {m.admin_remove()}
                  </Button>
                </ConfirmDialog>
              </div>
            )
          },
        }),
      ]),
    [roleMutation, removeMutation],
  )

  const invitationColumns = useMemo(
    () =>
      invitationHelper.columns([
        invitationHelper.accessor('email', {
          header: () => m.admin_email(),
          cell: ({ row }) => (
            <span className="flex items-center gap-2">
              <span className="font-medium">{row.original.email}</span>
              {isExpired(row.original) ? (
                <Badge variant="outline">{m.admin_invitations_expired()}</Badge>
              ) : null}
            </span>
          ),
        }),
        invitationHelper.accessor('role', {
          header: () => m.admin_role(),
          cell: ({ row }) => membershipRoleLabel(row.original.role),
        }),
        invitationHelper.accessor('createdAt', {
          header: () => m.admin_invitations_col_sent(),
          sortFn: 'datetime',
          cell: ({ row }) => (
            <span className="whitespace-nowrap text-muted-foreground">
              {formatDate(row.original.createdAt)}
            </span>
          ),
        }),
        invitationHelper.accessor('expiresAt', {
          header: () => m.admin_invitations_col_expires(),
          sortFn: 'datetime',
          cell: ({ row }) => (
            <span className="whitespace-nowrap text-muted-foreground">
              {formatDate(row.original.expiresAt)}
            </span>
          ),
        }),
        invitationHelper.display({
          id: 'actions',
          header: () => <span className="sr-only">{m.admin_actions()}</span>,
          enableSorting: false,
          cell: ({ row }) => {
            const invitation = row.original
            return (
              <div className="flex justify-end">
                <ConfirmDialog
                  title={m.admin_invitations_revoke_title()}
                  description={m.admin_invitations_revoke_description({
                    email: invitation.email,
                  })}
                  confirmLabel={m.admin_invitations_revoke_label()}
                  variant="destructive"
                  onConfirm={async () => {
                    await revokeMutation.mutateAsync(invitation.id)
                  }}
                >
                  <Button type="button" variant="ghost" size="sm">
                    {m.admin_invitations_revoke()}
                  </Button>
                </ConfirmDialog>
              </div>
            )
          },
        }),
      ]),
    [revokeMutation],
  )

  function onInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    inviteMutation.mutate()
  }

  return (
    <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
      <div className="grid gap-8">
        <section className="grid gap-4">
          <div className="flex items-center justify-between gap-2">
            <div className="grid gap-1">
              <h2 className="text-lg font-medium">{m.admin_members()}</h2>
              <p className="text-sm text-muted-foreground">
                {m.admin_members_blurb()}
              </p>
            </div>
            <DialogTrigger asChild>
              <Button type="button" data-testid="invite-member">
                <UserPlus />
                {m.admin_members_invite()}
              </Button>
            </DialogTrigger>
          </div>
          {membersQuery.isError ? (
            <QueryError
              title={m.admin_members_load_error()}
              error={membersQuery.error}
              onRetry={() => void membersQuery.refetch()}
              retrying={membersQuery.isFetching}
            />
          ) : membersQuery.isPending ? (
            <TableSkeleton columns={5} />
          ) : membersQuery.data.length === 0 ? (
            <EmptyState
              icon={<Users />}
              title={m.admin_members_empty_title()}
              description={m.admin_members_empty_description()}
              action={
                inviteOpen ? undefined : (
                  <Button type="button" onClick={() => setInviteOpen(true)}>
                    <UserPlus />
                    {m.admin_members_invite()}
                  </Button>
                )
              }
            />
          ) : (
            <DataTable
              columns={memberColumns}
              data={membersQuery.data}
              pageSize={25}
              initialSorting={[{ id: 'name', desc: false }]}
              caption={m.admin_members_caption()}
            />
          )}
        </section>

        <section className="grid gap-4" data-testid="pending-invitations">
          <div className="grid gap-1">
            <h2 className="text-lg font-medium">
              {m.admin_invitations_heading()}
            </h2>
            <p className="text-sm text-muted-foreground">
              {m.admin_invitations_blurb()}
            </p>
          </div>
          {invitationsQuery.isError ? (
            <QueryError
              title={m.admin_invitations_load_error()}
              error={invitationsQuery.error}
              onRetry={() => void invitationsQuery.refetch()}
              retrying={invitationsQuery.isFetching}
            />
          ) : invitationsQuery.isPending ? (
            <TableSkeleton rows={2} columns={5} />
          ) : pendingInvitations.length === 0 ? (
            <EmptyState
              icon={<EnvelopeSimple />}
              title={m.admin_invitations_empty_title()}
              description={m.admin_invitations_empty_description()}
            />
          ) : (
            <DataTable
              columns={invitationColumns}
              data={pendingInvitations}
              pageSize={25}
              initialSorting={[{ id: 'createdAt', desc: true }]}
              caption={m.admin_invitations_caption()}
            />
          )}
        </section>

        <DialogContent>
          <form className="grid gap-4" onSubmit={onInvite}>
            <DialogHeader>
              <DialogTitle>{m.admin_invite_title()}</DialogTitle>
              <DialogDescription>
                {m.admin_invite_description()}
              </DialogDescription>
            </DialogHeader>
            <FormField label={m.admin_email()} htmlFor="invite-email">
              <Input
                id="invite-email"
                data-testid="invite-email"
                type="email"
                required
                autoFocus
                autoComplete="email"
                placeholder={m.admin_invite_placeholder()}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </FormField>
            <FormField label={m.admin_role()} htmlFor="invite-role">
              <Select
                value={role}
                onValueChange={(value) => setRole(value as MembershipRole)}
              >
                <SelectTrigger id="invite-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner">
                    {membershipRoleOptionLabel('owner')}
                  </SelectItem>
                  <SelectItem value="editor">
                    {membershipRoleOptionLabel('editor')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setInviteOpen(false)}
                disabled={inviteMutation.isPending}
              >
                {m.admin_cancel()}
              </Button>
              <Button type="submit" disabled={inviteMutation.isPending}>
                {inviteMutation.isPending
                  ? m.admin_sending()
                  : m.admin_invite_send()}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </div>
    </Dialog>
  )
}
