import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { CaretLeft, DotsThree, Users } from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { EmptyState } from '#/components/ui/empty-state'
import { Hint } from '#/components/ui/tooltip'
import { QueryError } from '#/components/ui/query-error'
import { Skeleton } from '#/components/ui/skeleton'
import { Switch } from '#/components/ui/switch'
import { UserAvatar } from '#/components/ui/avatar'
import {
  accountsQuery,
  clientsQuery,
  personQuery,
} from '#/features/agency/queries'
import type { PersonDetail } from '#/features/agency/queries'
import { formatRelativeTime } from '#/lib/relative-time'
import { m } from '#/paraglide/messages'
import type { Me } from '#/server/fn/me'
import { errorMessage } from '#/lib/errors'

import { AccessSection } from './access-section'
import { DangerSection } from './danger-section'
import { PersonDialogs } from './person-dialogs'
import type { PersonDialog } from './person-dialogs'
import { isLastActiveAdmin } from './person-facts'
import { ProfileSection } from './profile-section'
import { SecuritySection } from './security-section'

/**
 * `/agency/people/$userId` (brief §3.9 and the Blocking, Security sections of
 * the account-management spec): one person, their clients, sign-in security,
 * name and the danger zone. Every section is a `SettingsSection`.
 */
export function PersonScreen({ me, userId }: { me: Me; userId: string }) {
  const detail = useQuery(personQuery(userId))
  const accounts = useQuery(accountsQuery())
  const clients = useQuery(clientsQuery())
  const [dialog, setDialog] = React.useState<PersonDialog | null>(null)

  if (detail.isPending) return <PersonSkeleton />

  if (detail.isError) {
    if (errorMessage(detail.error) === m.server_user_not_found()) {
      return (
        <EmptyState
          card
          tone="neutral"
          icon={<Users weight="duotone" />}
          title={m.agency_person_not_found_title()}
          description={m.agency_person_not_found_description()}
          action={
            <Button asChild variant="secondary">
              <Link to="/agency/people">{m.agency_person_back()}</Link>
            </Button>
          }
        />
      )
    }
    return <QueryError title={m.agency_person_load_error()} query={detail} />
  }

  const person = detail.data
  const isSelf = person.id === me.user.id
  const lastAdmin = isLastActiveAdmin(accounts.data ?? [], person.id)
  // The last active admin keeps the Agency workspace reachable: no block,
  // delete, or losing the admin role.
  const protectedAdmin = lastAdmin && person.isAgencyAdmin
  const selfReason = m.agency_person_self_reason()
  const lastAdminReason = m.agency_person_last_admin_reason()

  return (
    <div
      id="person-page"
      // While the save bar is up, leave room below the last section for it.
      className="grid gap-6 pb-24 has-[[data-dirty=true]]:pb-56 md:pb-20 md:has-[[data-dirty=true]]:pb-24"
      data-testid="person-page"
      data-ready="true"
    >
      <header className="grid gap-4">
        <Link
          to="/agency/people"
          className="inline-flex w-fit items-center gap-1 rounded-[6px] text-callout text-text-secondary outline-none hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          data-testid="person-back"
        >
          <CaretLeft weight="bold" className="size-3.5" />
          {m.agency_person_back()}
        </Link>

        <div className="flex items-start gap-4">
          <UserAvatar name={person.name} size="lg" className="mt-0.5" />
          <div className="grid min-w-0 flex-1 gap-1">
            <h1
              className="text-display text-text-primary break-words"
              data-testid="person-name"
            >
              {person.name}
            </h1>
            <p
              className="truncate text-callout text-text-secondary"
              data-testid="person-email"
            >
              {person.email}
            </p>
            <p
              className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption font-normal text-text-muted tnum"
              data-testid="person-meta"
            >
              <span>
                {person.lastActiveAt
                  ? m.agency_people_last_active({
                      when: formatRelativeTime(person.lastActiveAt, {
                        withinDays: 7,
                      }),
                    })
                  : m.agency_people_never_active()}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {person.twoFactorEnabled
                  ? m.agency_person_2fa_on()
                  : m.agency_person_2fa_off()}
              </span>
            </p>
          </div>
          <PersonMenu
            isSelf={isSelf}
            person={person}
            onOpen={(next) => setDialog(next)}
            blockReason={
              isSelf ? selfReason : protectedAdmin ? lastAdminReason : undefined
            }
          />
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Hint
            label={
              isSelf
                ? m.admin_users_self_tooltip()
                : protectedAdmin
                  ? lastAdminReason
                  : undefined
            }
            wrapDisabled
          >
            <label className="inline-flex items-center gap-2.5 text-callout text-text-primary">
              <Switch
                checked={person.isAgencyAdmin}
                disabled={isSelf || protectedAdmin}
                onCheckedChange={(next) => setDialog({ kind: 'admin', next })}
                aria-label={m.admin_users_aria_agency_admin({
                  email: person.email,
                })}
                data-testid="person-agency-admin"
              />
              {m.agency_person_agency_admin()}
            </label>
          </Hint>
        </div>
      </header>

      {person.blocked ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-status-error-bg px-4 py-3"
          data-testid="person-blocked-band"
        >
          <div className="grid min-w-0 gap-0.5">
            <p className="text-[14px] leading-5 font-medium text-text-error">
              {person.blocked.byName
                ? m.agency_person_blocked_by({
                    when: formatRelativeTime(person.blocked.at, {
                      withinDays: 7,
                    }),
                    name: person.blocked.byName,
                  })
                : m.agency_person_blocked_on({
                    when: formatRelativeTime(person.blocked.at, {
                      withinDays: 7,
                    }),
                  })}
            </p>
            {person.blocked.reason ? (
              <p className="text-caption font-normal text-text-secondary break-words">
                {m.agency_person_block_note({ reason: person.blocked.reason })}
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setDialog({ kind: 'unblock' })}
            data-testid="person-unblock-band"
          >
            {m.agency_person_unblock_confirm({ name: person.name })}
          </Button>
        </div>
      ) : null}

      <AccessSection detail={person} clients={clients.data ?? []} />
      <SecuritySection
        person={person}
        isSelf={isSelf}
        onOpen={(next) => setDialog(next)}
      />
      <ProfileSection person={person} />
      <DangerSection
        person={person}
        isSelf={isSelf}
        protectedAdmin={protectedAdmin}
        selfReason={selfReason}
        lastAdminReason={lastAdminReason}
        onOpen={(next) => setDialog(next)}
      />

      <PersonDialogs
        person={person}
        dialog={dialog}
        onClose={() => setDialog(null)}
      />
    </div>
  )
}

function PersonMenu({
  person,
  isSelf,
  onOpen,
  blockReason,
}: {
  person: PersonDetail
  isSelf: boolean
  onOpen: (next: PersonDialog) => void
  blockReason?: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="quiet"
          size="icon-md"
          aria-label={m.agency_person_more()}
          data-testid="person-menu"
          className="touch-target"
        >
          <DotsThree weight="bold" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-60">
        {isSelf ? (
          <DropdownMenuItem asChild>
            <Link to="/account" data-testid="person-menu-account">
              {m.agency_person_go_to_account()}
            </Link>
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem
              onSelect={() => onOpen({ kind: 'sign-out' })}
              data-testid="person-menu-sign-out"
            >
              {m.agency_person_sign_out_action()}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => onOpen({ kind: 'reset-password' })}
              data-testid="person-menu-reset-password"
            >
              {m.agency_people_reset_action()}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!person.twoFactorEnabled}
              onSelect={() => onOpen({ kind: 'reset-2fa' })}
              data-testid="person-menu-reset-2fa"
            >
              {m.agency_person_reset_2fa_action()}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {person.blocked ? (
              <DropdownMenuItem
                disabled={Boolean(blockReason)}
                onSelect={() => onOpen({ kind: 'unblock' })}
                data-testid="person-menu-unblock"
              >
                {m.agency_person_unblock_confirm({ name: person.name })}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                disabled={Boolean(blockReason)}
                onSelect={() => onOpen({ kind: 'block' })}
                data-testid="person-menu-block"
              >
                {m.agency_person_block_confirm({ name: person.name })}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              variant="destructive"
              disabled={Boolean(blockReason)}
              onSelect={() => onOpen({ kind: 'delete' })}
              data-testid="person-menu-delete"
            >
              {m.agency_person_delete_confirm()}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PersonSkeleton() {
  return (
    <div className="grid gap-6" aria-busy="true" data-testid="person-skeleton">
      <div className="grid gap-4">
        <Skeleton className="h-4 w-20" />
        <div className="flex items-start gap-4">
          <Skeleton className="size-10 rounded-full" />
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-3.5 w-48" />
          </div>
        </div>
      </div>
      <div className="grid gap-4 border-t border-border-default pt-8 min-[900px]:grid-cols-[280px_minmax(0,1fr)] min-[900px]:gap-10">
        <div className="grid gap-2">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="overflow-hidden surface-card">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="flex items-center gap-3 border-t border-border-default px-4 py-4 first:border-t-0"
            >
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-7 w-32 rounded-control" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
