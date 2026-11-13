import * as React from 'react'
import { useNavigate, useRouter } from '@tanstack/react-router'
import {
  ArrowClockwise,
  Link as LinkIcon,
  DotsThree,
  EnvelopeSimple,
  UserMinus,
  UserPlus,
  Users,
} from '@phosphor-icons/react'
import { toast } from 'sonner'

import { errorMessage } from '#/lib/errors'
import { useShell } from '#/components/shell/shell-context'
import { UserAvatar } from '#/components/ui/avatar'
import { Tag } from '#/components/ui/tag'
import { Button } from '#/components/ui/button'
import { ConfirmDialog } from '#/components/ui/confirm-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { EmptyState } from '#/components/ui/empty-state'
import { InsetGroup, InsetIcon, InsetList } from '#/components/ui/inset-list'
import { QueryError } from '#/components/ui/query-error'
import { SegmentedControl } from '#/components/ui/segmented-control'
import { Skeleton } from '#/components/ui/skeleton'
import { Hint } from '#/components/ui/tooltip'
import { absoluteTimeLabel } from '#/lib/relative-time'
import type { MembershipRole } from '#/lib/types'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

import { InviteSheet } from './invite-sheet'
import { RegeneratedLinkDialog } from './regenerated-link-dialog'
import {
  expiresInLabel,
  isInvitationExpired,
  roleChangedMessage,
  useMembers,
} from './use-members'
import type { InvitationRow, MemberRow, RegeneratedLink } from './use-members'

type RowError = { id: string; message: string }

/**
 * People of one client (brief §3.9): members with a compact Owner | Editor
 * control, open invitations, and the invite sheet. Rendered by the site
 * People page (which owns the page header and the primary "Invite people")
 * and by the agency client "People" tab (which lets this component show its
 * own invite button).
 *
 * Test ids: `people-manager`, `invite-member` (open the sheet, when this
 * component renders it), `member-row-{email}`, `member-role-{email}`,
 * `pending-invitations`, `invitation-row-{email}`, `invite-email`.
 */
export function PeopleManager({
  organizationId,
  organizationName,
  inviteOpen: inviteOpenProp,
  onInviteOpenChange,
  showInviteButton = true,
}: {
  organizationId: string
  organizationName: string
  /** Control the invite sheet from outside (the page header button). */
  inviteOpen?: boolean
  onInviteOpenChange?: (open: boolean) => void
  /** Show the "Invite people" button above the member list. */
  showInviteButton?: boolean
}) {
  const { me } = useShell()
  const router = useRouter()
  const navigate = useNavigate()
  const people = useMembers(organizationId)
  const [internalOpen, setInternalOpen] = React.useState(false)
  const inviteOpen = inviteOpenProp ?? internalOpen
  const setInviteOpen = (open: boolean) => {
    setInternalOpen(open)
    onInviteOpenChange?.(open)
  }

  const [rowError, setRowError] = React.useState<RowError | null>(null)
  const [pendingRole, setPendingRole] = React.useState<
    Partial<Record<string, MembershipRole>>
  >({})
  const [demoteSelf, setDemoteSelf] = React.useState<MemberRow | null>(null)
  const [removeTarget, setRemoveTarget] = React.useState<MemberRow | null>(null)

  async function applyRole(member: MemberRow, role: MembershipRole) {
    setRowError(null)
    setPendingRole((prev) => ({ ...prev, [member.userId]: role }))
    try {
      await people.changeRole.mutateAsync({ userId: member.userId, role })
      toast.success(roleChangedMessage(role))
      if (member.userId === me.user.id) await router.invalidate()
    } catch (error) {
      setRowError({ id: member.userId, message: errorMessage(error) })
    } finally {
      setPendingRole((prev) => {
        const next = { ...prev }
        delete next[member.userId]
        return next
      })
    }
  }

  function onRoleChange(member: MemberRow, role: MembershipRole) {
    if (role === member.role) return
    if (
      member.userId === me.user.id &&
      member.role === 'owner' &&
      role === 'editor'
    ) {
      setDemoteSelf(member)
      return
    }
    void applyRole(member, role)
  }

  async function removeMember(member: MemberRow) {
    setRowError(null)
    try {
      await people.remove.mutateAsync(member.userId)
      toast.success(m.admin_members_toast_removed())
      if (member.userId === me.user.id) {
        await router.invalidate()
        await navigate({ to: '/' })
      }
    } catch (error) {
      setRowError({ id: member.userId, message: errorMessage(error) })
    }
  }

  const inviteButton = (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      onClick={() => setInviteOpen(true)}
      data-testid="invite-member"
    >
      <UserPlus />
      {m.people_invite_people()}
    </Button>
  )

  const memberCount = people.sortedMembers.length

  return (
    <div className="grid gap-10" data-testid="people-manager">
      <InsetGroup
        title={m.people_members_title()}
        description={
          people.members.isSuccess
            ? memberCount === 1
              ? m.people_members_count_one()
              : m.people_members_count_other({ count: memberCount })
            : undefined
        }
        actions={showInviteButton ? inviteButton : undefined}
        data-testid="people-members"
      >
        {people.members.isError ? (
          <QueryError title={m.people_load_error()} query={people.members} />
        ) : people.members.isPending ? (
          <MembersSkeleton />
        ) : memberCount === 0 ? (
          <EmptyState
            card
            size="sm"
            icon={<Users weight="duotone" />}
            title={m.people_empty_title()}
            description={m.people_empty_description({
              client: organizationName,
            })}
            action={
              <Button
                type="button"
                size="sm"
                onClick={() => setInviteOpen(true)}
              >
                <UserPlus />
                {m.people_invite_people()}
              </Button>
            }
          />
        ) : (
          <InsetList>
            {people.sortedMembers.map((member) => (
              <MemberRowView
                key={member.userId}
                member={member}
                isSelf={member.userId === me.user.id}
                organizationName={organizationName}
                role={pendingRole[member.userId] ?? member.role}
                busy={pendingRole[member.userId] !== undefined}
                error={
                  rowError?.id === member.userId ? rowError.message : undefined
                }
                onRoleChange={(role) => onRoleChange(member, role)}
                onRemove={() => setRemoveTarget(member)}
              />
            ))}
          </InsetList>
        )}
      </InsetGroup>

      <Invitations
        people={people}
        rowError={rowError}
        setRowError={setRowError}
      />

      <InviteSheet
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        organizationName={organizationName}
        invite={people.invite}
      />

      <ConfirmDialog
        open={demoteSelf !== null}
        onOpenChange={(open) => {
          if (!open) setDemoteSelf(null)
        }}
        title={m.people_demote_self_title()}
        description={m.people_demote_self_description({
          client: organizationName,
        })}
        confirmLabel={m.people_demote_self_confirm()}
        testId="demote-self-dialog"
        onConfirm={async () => {
          if (demoteSelf) await applyRole(demoteSelf, 'editor')
        }}
      />

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null)
        }}
        title={m.admin_members_remove_title({
          name: removeTarget?.name || removeTarget?.email || '',
        })}
        description={
          removeTarget
            ? m.admin_members_remove_description({ email: removeTarget.email })
            : undefined
        }
        confirmLabel={m.admin_members_remove_label()}
        variant="destructive"
        testId="remove-member-dialog"
        onConfirm={async () => {
          if (removeTarget) await removeMember(removeTarget)
        }}
      />
    </div>
  )
}

function MembersSkeleton() {
  return (
    <div className="grid overflow-hidden surface-card" aria-hidden="true">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className="flex items-center gap-3 border-b border-border-default px-4 py-3 last:border-b-0"
        >
          <Skeleton className="size-8 rounded-full" />
          <div className="grid flex-1 gap-1.5">
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="h-3 w-48" />
          </div>
          <Skeleton className="h-[30px] w-[132px] rounded-control" />
        </div>
      ))}
    </div>
  )
}

function MemberRowView({
  member,
  isSelf,
  organizationName,
  role,
  busy,
  error,
  onRoleChange,
  onRemove,
}: {
  member: MemberRow
  isSelf: boolean
  organizationName: string
  role: MembershipRole
  busy: boolean
  error?: string
  onRoleChange: (role: MembershipRole) => void
  onRemove: () => void
}) {
  const name = member.name || member.email
  return (
    <li
      data-slot="inset-row"
      data-testid={`member-row-${member.email}`}
      className="relative after:absolute after:right-0 after:bottom-0 after:left-[60px] after:h-px after:bg-border-default last:after:hidden"
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]">
        <UserAvatar name={name} size="md" />
        <div className="grid min-w-0 gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[14px] leading-5 font-medium text-text-primary">
              {name}
            </span>
            {isSelf ? <Tag tone="accent">{m.people_you()}</Tag> : null}
          </span>
          {member.name ? (
            <span className="truncate text-callout text-text-secondary">
              {member.email}
            </span>
          ) : null}
        </div>
        <div
          className={cn(
            'col-span-2 col-start-2 row-start-2 sm:col-span-1 sm:col-start-3 sm:row-start-1',
            busy && 'pointer-events-none opacity-60 transition-opacity',
          )}
          aria-busy={busy || undefined}
        >
          <SegmentedControl<MembershipRole>
            size="sm"
            value={role}
            onValueChange={onRoleChange}
            aria-label={m.admin_members_aria_role({ email: member.email })}
            data-testid={`member-role-${member.email}`}
            options={[
              {
                value: 'owner',
                label: m.people_role_owner(),
                testId: 'role-owner',
              },
              {
                value: 'editor',
                label: m.people_role_editor(),
                testId: 'role-editor',
              },
            ]}
          />
        </div>
        <div className="col-start-3 row-start-1 sm:col-start-4">
          <DropdownMenu>
            <Hint label={m.ui_more()}>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="quiet"
                  size="icon-sm"
                  aria-label={m.people_more_actions({ name })}
                  data-testid="member-actions"
                >
                  <DotsThree weight="bold" className="size-5" />
                </Button>
              </DropdownMenuTrigger>
            </Hint>
            <DropdownMenuContent align="end" className="min-w-56">
              <DropdownMenuItem variant="destructive" onSelect={onRemove}>
                <UserMinus />
                {m.people_remove_from({ client: organizationName })}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {error ? (
          <p
            role="alert"
            className="col-span-full text-callout text-text-error sm:col-start-2"
            data-testid="member-error"
          >
            {error}
          </p>
        ) : null}
      </div>
    </li>
  )
}

function Invitations({
  people,
  rowError,
  setRowError,
}: {
  people: ReturnType<typeof useMembers>
  rowError: RowError | null
  setRowError: (error: RowError | null) => void
}) {
  const [revokeTarget, setRevokeTarget] = React.useState<InvitationRow | null>(
    null,
  )
  const [regenerated, setRegenerated] = React.useState<{
    email: string
    link: RegeneratedLink
  } | null>(null)
  const [now, setNow] = React.useState<number | null>(null)
  // Relative expiry depends on the viewer's clock: compute after mount.
  React.useEffect(() => setNow(Date.now()), [people.invitations.dataUpdatedAt])

  if (people.invitations.isError) {
    return (
      <InsetGroup
        title={m.people_invitations_title()}
        data-testid="pending-invitations"
      >
        <QueryError
          title={m.people_invitations_load_error()}
          query={people.invitations}
        />
      </InsetGroup>
    )
  }
  if (people.openInvitations.length === 0) return null

  async function resend(row: InvitationRow) {
    setRowError(null)
    try {
      await people.resend.mutateAsync(row)
      toast.success(m.people_invite_sent_again())
    } catch (error) {
      setRowError({ id: row.id, message: errorMessage(error) })
    }
  }

  async function regenerate(row: InvitationRow) {
    setRowError(null)
    try {
      setRegenerated({
        email: row.email,
        link: await people.regenerate.mutateAsync(row),
      })
    } catch (error) {
      setRowError({ id: row.id, message: errorMessage(error) })
    }
  }

  return (
    <InsetGroup
      title={m.people_invitations_title()}
      description={m.people_invitations_description()}
      data-testid="pending-invitations"
    >
      <InsetList>
        {people.openInvitations.map((row) => {
          const expired = now !== null && isInvitationExpired(row, now)
          const roleLabel =
            row.role === 'owner'
              ? m.people_role_owner()
              : m.people_role_editor()
          const undelivered = row.deliveryStatus === 'failed'
          const resending =
            people.resend.isPending && people.resend.variables.id === row.id
          const regenerating =
            people.regenerate.isPending &&
            people.regenerate.variables.id === row.id
          return (
            <li
              key={row.id}
              data-testid={`invitation-row-${row.email}`}
              className="relative after:absolute after:right-0 after:bottom-0 after:left-[60px] after:h-px after:bg-border-default last:after:hidden"
            >
              <div className="flex min-h-[56px] items-center gap-3 px-4 py-2.5">
                <InsetIcon tone={expired ? 'neutral' : 'accent'}>
                  <EnvelopeSimple />
                </InsetIcon>
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate text-[14px] leading-5 font-medium text-text-primary">
                    {row.email}
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5 text-callout text-text-secondary">
                    <span>{roleLabel}</span>
                    <span aria-hidden="true">·</span>
                    {undelivered ? (
                      <Tag tone="warning" data-testid="invitation-undelivered">
                        {m.people_invite_email_failed()}
                      </Tag>
                    ) : row.deliveryStatus === 'queued' ? (
                      <Tag tone="neutral" data-testid="invitation-queued">
                        {m.people_invite_email_queued()}
                      </Tag>
                    ) : null}
                    {expired ? (
                      <Tag tone="warning">{m.people_invite_expired()}</Tag>
                    ) : (
                      <span
                        className="truncate text-text-muted"
                        title={absoluteTimeLabel(row.expiresAt)}
                      >
                        {now !== null
                          ? m.people_invite_expires({
                              time: expiresInLabel(row.expiresAt, now),
                            })
                          : null}
                      </span>
                    )}
                  </span>
                  {rowError?.id === row.id ? (
                    <span role="alert" className="text-callout text-text-error">
                      {rowError.message}
                    </span>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    loading={regenerating}
                    onClick={() => void regenerate(row)}
                    data-testid="invitation-regenerate-link"
                  >
                    {regenerating ? null : <LinkIcon />}
                    {m.people_invite_regenerate_link()}
                  </Button>
                  {expired || undelivered ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      loading={resending}
                      onClick={() => void resend(row)}
                      data-testid="invitation-resend"
                    >
                      {resending ? null : <ArrowClockwise />}
                      {m.people_invite_send_again()}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="quiet"
                    onClick={() => setRevokeTarget(row)}
                    data-testid="invitation-revoke"
                  >
                    {m.admin_invitations_revoke()}
                  </Button>
                </div>
              </div>
            </li>
          )
        })}
      </InsetList>

      <RegeneratedLinkDialog
        link={regenerated?.link ?? null}
        email={regenerated?.email ?? ''}
        onClose={() => setRegenerated(null)}
      />

      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null)
        }}
        title={m.admin_invitations_revoke_title()}
        description={
          revokeTarget
            ? m.admin_invitations_revoke_description({
                email: revokeTarget.email,
              })
            : undefined
        }
        confirmLabel={m.admin_invitations_revoke_label()}
        variant="destructive"
        testId="revoke-invitation-dialog"
        onConfirm={async () => {
          if (!revokeTarget) return
          try {
            await people.revoke.mutateAsync(revokeTarget.id)
            toast.success(m.admin_members_toast_revoked())
          } catch (error) {
            setRowError({ id: revokeTarget.id, message: errorMessage(error) })
          }
        }}
      />
    </InsetGroup>
  )
}
