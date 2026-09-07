import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { toast } from 'sonner'

import { ConfirmDialog } from '#/components/confirm-dialog'
import { EmptyState } from '#/components/empty-state'
import { FormField } from '#/components/form-field'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import type { MembershipRole } from '#/lib/types'
import {
  inviteMemberFn,
  listInvitationsFn,
  listMembersFn,
  removeMemberFn,
  revokeInvitationFn,
  updateMemberRoleFn,
} from '#/server/fn/admin'

import { adminQueryKeys, errorMessage } from './helpers'
import { TableSkeleton } from './table-skeleton'

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
    onSuccess: async () => {
      toast.success('Role updated')
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
      inviteMember({ data: { organizationId, email, role } }),
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

  const pending = (invitationsQuery.data ?? []).filter(
    (invitation) => !invitation.acceptedAt,
  )

  function onInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    inviteMutation.mutate()
  }

  return (
    <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
    <div className="grid gap-8">
      <section className="grid gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-medium">Members</h2>
          <DialogTrigger asChild>
            <Button type="button" data-testid="invite-member">
              Invite
            </Button>
          </DialogTrigger>
        </div>
        {membersQuery.isLoading ? (
          <TableSkeleton />
        ) : membersQuery.data?.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {membersQuery.data.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>{member.name}</TableCell>
                  <TableCell>{member.email}</TableCell>
                  <TableCell>
                    <Select
                      value={member.role}
                      onValueChange={(value) =>
                        roleMutation.mutate({
                          userId: member.userId,
                          role: value as MembershipRole,
                        })
                      }
                    >
                      <SelectTrigger className="w-32" aria-label="Role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="owner">owner</SelectItem>
                        <SelectItem value="editor">editor</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <ConfirmDialog
                      title="Remove member"
                      description={`Remove ${member.email} from this organization?`}
                      confirmLabel="Remove"
                      onConfirm={async () => {
                        await removeMutation.mutateAsync(member.userId)
                      }}
                    >
                      <Button type="button" variant="ghost" size="sm">
                        Remove
                      </Button>
                    </ConfirmDialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState
            title="No members"
            description="Invite someone to this organization."
            action={
              inviteOpen ? undefined : (
                <Button type="button" onClick={() => setInviteOpen(true)}>
                  Invite
                </Button>
              )
            }
          />
        )}
      </section>

      <section className="grid gap-3" data-testid="pending-invitations">
        <h2 className="text-lg font-medium">Pending invitations</h2>
        {invitationsQuery.isLoading ? (
          <TableSkeleton rows={2} />
        ) : pending.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pending.map((invitation) => (
                <TableRow key={invitation.id}>
                  <TableCell>{invitation.email}</TableCell>
                  <TableCell>{invitation.role}</TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => revokeMutation.mutate(invitation.id)}
                    >
                      Revoke
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState
            title="No pending invitations"
            description="Invitations appear here until they are accepted or revoked."
          />
        )}
      </section>

      <DialogContent>
          <form className="grid gap-4" onSubmit={onInvite}>
            <DialogHeader>
              <DialogTitle>Invite member</DialogTitle>
              <DialogDescription>
                Send an email invitation to join this organization.
              </DialogDescription>
            </DialogHeader>
            <FormField label="Email" htmlFor="invite-email">
              <Input
                id="invite-email"
                data-testid="invite-email"
                type="email"
                required
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
