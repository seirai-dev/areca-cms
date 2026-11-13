import { Link } from '@tanstack/react-router'
import {
  DotsThree,
  EnvelopeSimple,
  Key,
  LockKey,
  LockOpen,
  Prohibit,
  SignOut,
  UserCircle,
} from '@phosphor-icons/react'

import { membershipRoleLabel } from '#/lib/admin/helpers'
import {
  expiresInLabel,
  isInvitationExpired,
} from '#/features/people/use-members'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Hint } from '#/components/ui/tooltip'
import { InsetIcon } from '#/components/ui/inset-list'
import { Skeleton } from '#/components/ui/skeleton'
import { Tag } from '#/components/ui/tag'
import { UserAvatar } from '#/components/ui/avatar'
import { absoluteTimeLabel, formatRelativeTime } from '#/lib/relative-time'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

import type { AccountRow, PendingInvitationRow } from './queries'

/** What a person row's menu can start. */
export type PersonAction =
  'reset' | 'lockout' | 'block' | 'unblock' | 'sign-out'

export function PeopleSkeleton() {
  return (
    <div className="grid gap-4" aria-busy="true">
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-9 w-80" />
      </div>
      <div className="overflow-hidden surface-card">
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            key={index}
            className="flex items-center gap-3 border-b border-border-default px-4 py-3.5 last:border-b-0"
          >
            <Skeleton className="size-4 rounded-[5px]" />
            <Skeleton className="size-10 rounded-full" />
            <div className="grid flex-1 gap-2">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
            <Skeleton className="hidden h-3 w-16 sm:block" />
          </div>
        ))}
      </div>
    </div>
  )
}

const ROW_CLASS =
  'relative flex items-stretch after:absolute after:right-0 after:bottom-0 after:left-[46px] after:h-px after:bg-border-default last:after:hidden'

export function PersonRow({
  account,
  isSelf,
  selected,
  onSelectedChange,
  protectedAdmin,
  onAction,
}: {
  account: AccountRow
  isSelf: boolean
  selected: boolean
  onSelectedChange: (on: boolean) => void
  /** The last active agency admin: cannot be blocked. */
  protectedAdmin: boolean
  onAction: (action: PersonAction) => void
}) {
  const blocked = account.status === 'blocked'
  const lastActive = formatRelativeTime(account.lastActiveAt, { withinDays: 7 })
  const lastActiveLabel = account.lastActiveAt
    ? m.agency_people_last_active({ when: lastActive })
    : m.agency_people_never_active()
  return (
    <li
      className={cn(
        ROW_CLASS,
        'transition-colors duration-150 hover:bg-surface-state-hover has-[a:focus-visible]:bg-surface-state-hover has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-border-focus',
        selected && 'bg-accent-soft/40 hover:bg-accent-soft/60',
      )}
      data-testid={`person-row-${account.email}`}
      data-status={account.status}
      data-selected={selected ? 'true' : undefined}
    >
      <span className="flex items-center pl-4">
        <Checkbox
          className="relative touch-target"
          checked={selected}
          onCheckedChange={(checked) => onSelectedChange(checked === true)}
          aria-label={m.agency_people_select({ name: account.name })}
          data-testid={`person-select-${account.email}`}
        />
      </span>
      <Link
        to="/agency/people/$userId"
        params={{ userId: account.id }}
        className="flex min-w-0 flex-1 items-center gap-3 py-3 pr-2 pl-3 outline-none"
        data-testid={`person-link-${account.email}`}
      >
        <UserAvatar name={account.name} size="lg" />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            {/* Short names wrap onto their own line, so the tags never truncate the name; only a very long name is clamped. */}
            <span
              className={cn(
                'line-clamp-2 min-w-0 max-w-full text-[14px] leading-5 font-medium break-words text-text-primary',
                blocked && 'text-text-muted',
              )}
            >
              {account.name}
            </span>
            {isSelf ? <Tag tone="accent">{m.admin_you()}</Tag> : null}
            {account.isAgencyAdmin ? (
              <Tag tone="outline">{m.agency_people_agency_admin()}</Tag>
            ) : null}
            {blocked ? (
              <Tag tone="error">{m.agency_people_blocked()}</Tag>
            ) : null}
          </span>
          <span className="truncate text-callout text-text-secondary">
            {account.email}
          </span>
          <span className="truncate text-caption font-normal text-text-muted sm:hidden">
            {lastActiveLabel}
          </span>
          <span className="mt-0.5 hidden flex-wrap items-center gap-1.5 sm:flex">
            {account.memberships.length === 0 ? (
              <span className="text-caption font-normal text-text-muted">
                {m.agency_people_no_clients()}
              </span>
            ) : (
              account.memberships.map((item) => (
                <span
                  key={item.organizationId}
                  className="inline-flex h-[22px] items-center gap-1 rounded-full border border-border-default bg-background-subtle px-2 text-[12px] leading-4 font-medium whitespace-nowrap text-text-primary"
                  data-testid="membership-chip"
                >
                  {item.organizationName}
                  <span className="text-text-muted">
                    · {membershipRoleLabel(item.role)}
                  </span>
                </span>
              ))
            )}
          </span>
        </span>
        <Hint label={absoluteTimeLabel(account.lastActiveAt)}>
          <span className="hidden shrink-0 text-caption font-normal text-text-muted tnum sm:block">
            {account.lastActiveAt ? lastActive : m.agency_people_never_active()}
          </span>
        </Hint>
      </Link>
      <span className="flex items-center pr-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="quiet"
              size="icon-sm"
              aria-label={m.people_more_actions({ name: account.name })}
              data-testid={`person-menu-${account.email}`}
              className="touch-target"
            >
              <DotsThree weight="bold" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            <DropdownMenuItem
              asChild
              data-testid={`person-open-${account.email}`}
            >
              <Link to="/agency/people/$userId" params={{ userId: account.id }}>
                <UserCircle />
                {m.agency_people_open_profile()}
              </Link>
            </DropdownMenuItem>
            {isSelf ? null : (
              <DropdownMenuItem
                onSelect={() => onAction('sign-out')}
                data-testid={`sign-out-${account.email}`}
              >
                <SignOut />
                {m.agency_person_sign_out_action()}
              </DropdownMenuItem>
            )}
            {isSelf ? null : (
              <DropdownMenuItem
                onSelect={() => onAction('reset')}
                data-testid={`send-reset-link-${account.email}`}
              >
                <Key />
                {m.agency_people_reset_action()}
              </DropdownMenuItem>
            )}
            {account.isAgencyAdmin && account.factorLockedUntil && !isSelf ? (
              <DropdownMenuItem
                onSelect={() => onAction('lockout')}
                data-testid={`reset-factor-lockout-${account.email}`}
              >
                <LockKey />
                {m.account_factor_lockout_reset()}
              </DropdownMenuItem>
            ) : null}
            {isSelf ? null : (
              <>
                <DropdownMenuSeparator />
                {blocked ? (
                  <DropdownMenuItem
                    onSelect={() => onAction('unblock')}
                    data-testid={`unblock-${account.email}`}
                  >
                    <LockOpen />
                    {m.agency_people_menu_unblock()}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    disabled={protectedAdmin}
                    onSelect={() => onAction('block')}
                    data-testid={`block-${account.email}`}
                  >
                    <Prohibit />
                    {m.agency_people_menu_block()}
                  </DropdownMenuItem>
                )}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </li>
  )
}

export function InvitationRow({
  invitation,
  onResend,
  onCopyLink,
  onRevoke,
}: {
  invitation: PendingInvitationRow
  onResend: () => void
  onCopyLink: () => void
  onRevoke: () => void
}) {
  const expired = isInvitationExpired(invitation)
  const roleLine = `${invitation.organizationName} · ${membershipRoleLabel(invitation.role)}`
  return (
    <li
      className={ROW_CLASS}
      data-testid={`invitation-row-${invitation.email}`}
      data-status="invited"
    >
      <span className="flex items-center pl-4">
        <span aria-hidden="true" className="size-[18px]" />
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-3 py-3 pr-2 pl-3">
        <InsetIcon>
          <EnvelopeSimple />
        </InsetIcon>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[14px] leading-5 font-medium text-text-primary">
              {invitation.email}
            </span>
            <Tag tone="neutral">{m.agency_people_invited()}</Tag>
            {expired ? (
              <Tag tone="warning">{m.people_invite_expired()}</Tag>
            ) : null}
          </span>
          <span className="truncate text-callout text-text-secondary">
            {roleLine}
          </span>
          <span className="truncate text-caption font-normal text-text-muted">
            {expired
              ? m.people_invite_expired()
              : m.people_invite_expires({
                  time: expiresInLabel(invitation.expiresAt),
                })}
          </span>
        </span>
      </span>
      <span className="flex items-center pr-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="quiet"
              size="icon-sm"
              aria-label={m.people_more_actions({ name: invitation.email })}
              data-testid={`invitation-menu-${invitation.email}`}
              className="touch-target"
            >
              <DotsThree weight="bold" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            <DropdownMenuItem
              onSelect={onResend}
              data-testid="invitation-resend"
            >
              {m.people_invite_send_again()}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={onCopyLink}
              data-testid="invitation-copy-link"
            >
              {m.people_invite_copy_link()}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={onRevoke}
              data-testid="invitation-revoke"
            >
              {m.admin_invitations_revoke()}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </li>
  )
}
