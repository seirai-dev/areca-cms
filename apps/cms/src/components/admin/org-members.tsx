import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { MailPlus, UserPlus, Users } from 'lucide-react'
import { toast } from 'sonner'

import { ConfirmDialog } from '#/components/confirm-dialog'
import { createDataColumns, DataTable } from '#/components/data-table'
import { EmptyState } from '#/components/empty-state'
import { FormField } from '#/components/form-field'
import { QueryError } from '#/components/query-error'
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
import {
  inviteMemberFn,
  listInvitationsFn,
  listMembersFn,
  removeMemberFn,
  revokeInvitationFn,
  updateMemberRoleFn,
} from '#/server/fn/admin'

import { adminQueryKeys, errorMessage, formatDate } from './helpers'
import { TableSkeleton } from './table-skeleton'

type MemberRow = Awaited<ReturnType<typeof listMembersFn>>[number]
type InvitationRow = Awaited<ReturnType<typeof listInvitationsFn>>[number]

const ROLE_LABELS: Record<MembershipRole, string> = {
  owner: 'Owner',
  editor: 'Editor',
}

const memberHelper = createDataColumns<MemberRow>()
const invitationHelper = createDataColumns<InvitationRow>()

function isExpired(invitation: InvitationRow) {
  const expires = new Date(invitation.expiresAt)
  return !Number.isNaN(expires.getTime()) && expires.getTime() < Date.now()
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
      toast.success(`Role changed to ${ROLE_LABELS[input.role].toLowerCase()}`)
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
      toast.success('Member removed')
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
      toast.success('Invitation sent')
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
      toast.success('Invitation revoked')
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
          header: 'Name',
          cell: ({ row }) => (
            <span className="font-medium">{row.original.name}</span>
          ),
        }),
        memberHelper.accessor('email', {
          header: 'Email',
          cell: ({ row }) => (
            <span className="text-muted-foreground">{row.original.email}</span>
          ),
        }),
        memberHelper.accessor('role', {
          header: 'Role',
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
                  aria-label={`Role for ${member.email}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner">owner</SelectItem>
                  <SelectItem value="editor">editor</SelectItem>
                </SelectContent>
              </Select>
            )
          },
        }),
        memberHelper.accessor('createdAt', {
          header: 'Joined',
          sortFn: 'datetime',
          cell: ({ row }) => (
            <span className="whitespace-nowrap text-muted-foreground">
              {formatDate(row.original.createdAt)}
            </span>
          ),
        }),
        memberHelper.display({
          id: 'actions',
          header: () => <span className="sr-only">Actions</span>,
          enableSorting: false,
          cell: ({ row }) => {
            const member = row.original
            return (
              <div className="flex justify-end">
                <ConfirmDialog
                  title={`Remove ${member.name}?`}
                  description={`${member.email} will lose access to this organization and its sites. You can invite them again later.`}
                  confirmLabel="Remove member"
                  variant="destructive"
                  onConfirm={async () => {
                    await removeMutation.mutateAsync(member.userId)
                  }}
                >
                  <Button type="button" variant="ghost" size="sm">
                    Remove
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
          header: 'Email',
          cell: ({ row }) => (
            <span className="flex items-center gap-2">
              <span className="font-medium">{row.original.email}</span>
              {isExpired(row.original) ? (
                <Badge variant="outline">Expired</Badge>
              ) : null}
            </span>
          ),
        }),
        invitationHelper.accessor('role', {
          header: 'Role',
          cell: ({ row }) => ROLE_LABELS[row.original.role],
        }),
        invitationHelper.accessor('createdAt', {
          header: 'Sent',
          sortFn: 'datetime',
          cell: ({ row }) => (
            <span className="whitespace-nowrap text-muted-foreground">
              {formatDate(row.original.createdAt)}
            </span>
          ),
        }),
        invitationHelper.accessor('expiresAt', {
          header: 'Expires',
          sortFn: 'datetime',
          cell: ({ row }) => (
            <span className="whitespace-nowrap text-muted-foreground">
              {formatDate(row.original.expiresAt)}
            </span>
          ),
        }),
        invitationHelper.display({
          id: 'actions',
          header: () => <span className="sr-only">Actions</span>,
          enableSorting: false,
          cell: ({ row }) => {
            const invitation = row.original
            return (
              <div className="flex justify-end">
                <ConfirmDialog
                  title="Revoke invitation?"
                  description={`The invitation link sent to ${invitation.email} will stop working. You can send a new one at any time.`}
                  confirmLabel="Revoke invitation"
                  variant="destructive"
                  onConfirm={async () => {
                    await revokeMutation.mutateAsync(invitation.id)
                  }}
                >
                  <Button type="button" variant="ghost" size="sm">
                    Revoke
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
              <h2 className="text-lg font-medium">Members</h2>
              <p className="text-sm text-muted-foreground">
                Owners manage the team and settings; editors work on content.
              </p>
            </div>
            <DialogTrigger asChild>
              <Button type="button" data-testid="invite-member">
                <UserPlus />
                Invite
              </Button>
            </DialogTrigger>
          </div>
          {membersQuery.isError ? (
            <QueryError
              title="Could not load members"
              error={membersQuery.error}
              onRetry={() => void membersQuery.refetch()}
              retrying={membersQuery.isFetching}
            />
          ) : membersQuery.isPending ? (
            <TableSkeleton columns={5} />
          ) : membersQuery.data.length === 0 ? (
            <EmptyState
              icon={<Users />}
              title="No members yet"
              description="Invite someone by email. They will join as soon as they accept."
              action={
                inviteOpen ? undefined : (
                  <Button type="button" onClick={() => setInviteOpen(true)}>
                    <UserPlus />
                    Invite
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
              caption="Members"
            />
          )}
        </section>

        <section className="grid gap-4" data-testid="pending-invitations">
          <div className="grid gap-1">
            <h2 className="text-lg font-medium">Pending invitations</h2>
            <p className="text-sm text-muted-foreground">
              Invitations stay here until they are accepted or revoked.
            </p>
          </div>
          {invitationsQuery.isError ? (
            <QueryError
              title="Could not load invitations"
              error={invitationsQuery.error}
              onRetry={() => void invitationsQuery.refetch()}
              retrying={invitationsQuery.isFetching}
            />
          ) : invitationsQuery.isPending ? (
            <TableSkeleton rows={2} columns={5} />
          ) : pendingInvitations.length === 0 ? (
            <EmptyState
              icon={<MailPlus />}
              title="No pending invitations"
              description="Everyone you have invited has already joined."
            />
          ) : (
            <DataTable
              columns={invitationColumns}
              data={pendingInvitations}
              pageSize={25}
              initialSorting={[{ id: 'createdAt', desc: true }]}
              caption="Pending invitations"
            />
          )}
        </section>

        <DialogContent>
          <form className="grid gap-4" onSubmit={onInvite}>
            <DialogHeader>
              <DialogTitle>Invite member</DialogTitle>
              <DialogDescription>
                Send an email invitation to join this organization. The link
                expires after 7 days.
              </DialogDescription>
            </DialogHeader>
            <FormField label="Email" htmlFor="invite-email">
              <Input
                id="invite-email"
                data-testid="invite-email"
                type="email"
                required
                autoFocus
                autoComplete="email"
                placeholder="name@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </FormField>
            <FormField label="Role" htmlFor="invite-role">
              <Select
                value={role}
                onValueChange={(value) => setRole(value as MembershipRole)}
              >
                <SelectTrigger id="invite-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner">owner</SelectItem>
                  <SelectItem value="editor">editor</SelectItem>
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
                Cancel
              </Button>
              <Button type="submit" disabled={inviteMutation.isPending}>
                {inviteMutation.isPending ? 'Sending…' : 'Send invitation'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </div>
    </Dialog>
  )
}
