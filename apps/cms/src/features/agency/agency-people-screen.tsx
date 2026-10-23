import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  DotsThree,
  EnvelopeSimple,
  Key,
  MagnifyingGlass,
  Plus,
  Users,
  X,
} from '@phosphor-icons/react'
import { toast } from 'sonner'

import { errorMessage, membershipRoleLabel } from '#/lib/admin/helpers'
import { ClientPicker } from '#/features/agency/client-picker'
import { InvitePersonSheet } from '#/features/agency/invite-person-sheet'
import { usePeopleMutations } from '#/features/agency/use-people-mutations'
import {
  ALL_CLIENTS,
  ROLE_FILTERS,
  STATUS_FILTERS,
  countByStatus,
  filterAccounts,
  filterInvitations,
  hasActiveFilters,
} from '#/features/agency/people-list'
import type {
  PeopleFilters,
  RoleFilter,
  StatusFilter,
} from '#/features/agency/people-list'
import { RegeneratedLinkDialog } from '#/features/people/regenerated-link-dialog'
import { BlockPersonDialog } from '#/features/agency/person/block-person-dialog'
import { isLastActiveAdmin } from '#/features/agency/person/person-facts'
import {
  expiresInLabel,
  isInvitationExpired,
} from '#/features/people/use-members'
import type { RegeneratedLink } from '#/features/people/use-members'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { ConfirmDialog } from '#/components/ui/confirm-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { EmptyState } from '#/components/ui/empty-state'
import {
  FloatingBar,
  FloatingBarDivider,
  FloatingBarLabel,
} from '#/components/ui/floating-bar'
import { Hint } from '#/components/ui/tooltip'
import { Input } from '#/components/ui/input'
import { InsetIcon, InsetList } from '#/components/ui/inset-list'
import { PageHeader } from '#/components/ui/page-header'
import { QueryError } from '#/components/ui/query-error'
import { SegmentedControl } from '#/components/ui/segmented-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Skeleton } from '#/components/ui/skeleton'
import { Tag } from '#/components/ui/tag'
import { UserAvatar } from '#/components/ui/avatar'
import { absoluteTimeLabel, formatRelativeTime } from '#/lib/relative-time'
import { cn } from '#/lib/utils'
import { useDebouncedValue } from '#/hooks/use-debounced-value'
import { m } from '#/paraglide/messages'
import type { Me } from '#/server/fn/me'
import type { BulkResult } from '#/server/admin/users'
import type { MembershipRole } from '#/lib/types'

import { accountsQuery, clientsQuery, pendingInvitationsQuery } from './queries'
import type { AccountRow, PendingInvitationRow } from './queries'
import type { ClientPick } from './person/access-stage'

/** `/agency/people`: everyone with an account, and open invitations. */
export function AgencyPeopleScreen({
  me,
  filters,
  onFiltersChange,
}: {
  me: Me
  filters: PeopleFilters
  onFiltersChange: (next: PeopleFilters) => void
}) {
  const accounts = useQuery(accountsQuery())
  const invitations = useQuery(pendingInvitationsQuery())
  const clients = useQuery(clientsQuery())
  const mutations = usePeopleMutations()

  // The search box keeps its own draft; the URL gets the settled value, so
  // typing never waits on the router.
  const [draftSearch, setDraftSearch] = React.useState(filters.search)
  const settledSearch = useDebouncedValue(draftSearch, 250)
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set())
  const [inviteOpen, setInviteOpen] = React.useState(false)
  const [resetTarget, setResetTarget] = React.useState<AccountRow | null>(null)
  const [lockoutTarget, setLockoutTarget] = React.useState<AccountRow | null>(
    null,
  )
  const [revokeTarget, setRevokeTarget] =
    React.useState<PendingInvitationRow | null>(null)
  const [regenerated, setRegenerated] = React.useState<{
    link: RegeneratedLink
    email: string
  } | null>(null)
  const [bulk, setBulk] = React.useState<
    'block' | 'unblock' | 'sign-out' | null
  >(null)
  // One person's block, unblock or sign-out, from the row's menu.
  const [rowAction, setRowAction] = React.useState<{
    kind: 'block' | 'unblock' | 'sign-out'
    account: AccountRow
  } | null>(null)

  const allAccounts = accounts.data ?? []
  const allInvitations = invitations.data ?? []
  // The last active agency admin cannot be blocked, from the list either.
  const lastAdminId = allAccounts.find((account) =>
    isLastActiveAdmin(allAccounts, account.id),
  )?.id
  const counts = countByStatus(allAccounts, allInvitations)

  const people = React.useMemo(
    () =>
      filterAccounts(allAccounts, filters).sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    [allAccounts, filters],
  )
  const pending = React.useMemo(
    () =>
      filterInvitations(allInvitations, filters).sort((a, b) =>
        a.email.localeCompare(b.email),
      ),
    [allInvitations, filters],
  )
  const rowCount = people.length + pending.length
  const filtersActive = hasActiveFilters(filters)

  // Selection only ever covers the people on screen; a filter change narrows
  // it without a reset effect.
  const visibleIds = React.useMemo(
    () => new Set(people.map((person) => person.id)),
    [people],
  )
  const picked = React.useMemo(
    () => [...selected].filter((id) => visibleIds.has(id)),
    [selected, visibleIds],
  )
  const pickedSet = React.useMemo(() => new Set(picked), [picked])
  const names = React.useMemo(
    () => new Map(allAccounts.map((account) => [account.id, account.name])),
    [allAccounts],
  )

  const clear = React.useCallback(() => setSelected(new Set()), [])

  // Escape clears the selection, unless an overlay has it.
  React.useEffect(() => {
    if (picked.length === 0) return
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      if (
        document.querySelector(
          '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]',
        )
      ) {
        return
      }
      clear()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [picked.length, clear])

  React.useEffect(() => {
    if (settledSearch !== filters.search) {
      onFiltersChange({ ...filters, search: settledSearch })
    }
  }, [settledSearch, filters, onFiltersChange])

  function setFilters(patch: Partial<PeopleFilters>) {
    onFiltersChange({ ...filters, ...patch })
  }

  function clearFilters() {
    setDraftSearch('')
    onFiltersChange({
      search: '',
      status: 'all',
      role: 'all',
      clientId: ALL_CLIENTS,
    })
  }

  function toggle(id: string, on: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function toggleAll(on: boolean) {
    setSelected(on ? new Set(people.map((person) => person.id)) : new Set())
  }

  const allVisibleSelected =
    people.length > 0 && picked.length === people.length
  const someSelected = picked.length > 0 && !allVisibleSelected

  /** Reports what happened, and who was skipped and why. */
  function reportBulk(result: BulkResult, done: (count: number) => string) {
    if (result.done.length > 0) toast.success(done(result.done.length))
    if (result.skipped.length > 0) {
      toast.warning(m.agency_people_bulk_skipped(), {
        description: (
          <ul className="mt-1 grid gap-1">
            {result.skipped.map((item) => (
              <li key={item.userId}>
                <span className="font-medium">
                  {names.get(item.userId) ?? item.userId}
                </span>
                {' · '}
                {item.message}
              </li>
            ))}
          </ul>
        ),
      })
    }
    clear()
  }

  async function runBulk(
    action: () => Promise<BulkResult>,
    done: (count: number) => string,
  ) {
    try {
      reportBulk(await action(), done)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  // The client menu and the clear button, shared by the desktop and phone rows.
  const clientSelect = ({
    className,
    testId,
  }: {
    className: string
    testId: string
  }) => (
    <Select
      value={filters.clientId}
      onValueChange={(clientId) => setFilters({ clientId })}
    >
      <SelectTrigger
        className={className}
        aria-label={m.activity_filter_client()}
        data-testid={testId}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_CLIENTS}>{m.activity_all_clients()}</SelectItem>
        {(clients.data ?? []).map((client) => (
          <SelectItem key={client.id} value={client.id}>
            {client.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
  const clearButton = filtersActive ? (
    <Button
      type="button"
      variant="quiet"
      size="sm"
      onClick={clearFilters}
      data-testid="people-clear-filters"
    >
      <X />
      {m.admin_users_clear_filters()}
    </Button>
  ) : null

  return (
    <div
      id="people-page"
      className={cn(
        'grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6',
        picked.length > 0 && 'pb-24 md:pb-20',
      )}
      data-testid="agency-people"
      data-ready={accounts.isSuccess ? 'true' : undefined}
    >
      <PageHeader
        title={m.shell_nav_people()}
        description={m.agency_people_description()}
        actions={
          <Button
            type="button"
            onClick={() => setInviteOpen(true)}
            data-testid="invite-person"
          >
            <Plus />
            {m.agency_people_invite()}
          </Button>
        }
      />

      {accounts.isError ? (
        <QueryError
          title={m.agency_people_load_error()}
          error={accounts.error}
          onRetry={() => void accounts.refetch()}
          retrying={accounts.isFetching}
        />
      ) : accounts.isPending ? (
        <PeopleSkeleton />
      ) : allAccounts.length === 0 && allInvitations.length === 0 ? (
        <EmptyState
          card
          icon={<Users weight="duotone" />}
          title={m.admin_users_empty_title()}
          description={m.admin_users_empty_description()}
          action={
            <Button onClick={() => setInviteOpen(true)}>
              <Plus />
              {m.agency_people_invite()}
            </Button>
          }
        />
      ) : (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="relative w-full lg:max-w-xs">
              <MagnifyingGlass className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-icon-muted" />
              <Input
                id="user-search"
                type="search"
                aria-label={m.admin_users_search_label()}
                placeholder={m.admin_users_search_placeholder()}
                className="pl-9"
                value={draftSearch}
                onChange={(event) => setDraftSearch(event.target.value)}
                data-shortcut-search
              />
            </div>
            <div className="hidden min-w-0 flex-wrap items-center gap-2 sm:flex">
              {clientSelect({
                className: 'w-44',
                testId: 'people-client-filter',
              })}
              {clearButton}
            </div>
          </div>

          {/* Phones: status and role become menus, the client menu takes a row. */}
          <div className="grid grid-cols-2 gap-2 sm:hidden">
            <Select
              value={filters.status}
              onValueChange={(status) =>
                setFilters({ status: status as StatusFilter })
              }
            >
              <SelectTrigger
                className="w-full min-w-0"
                aria-label={m.agency_people_filter_status_aria()}
                data-testid="people-status-select"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTERS.map((status) => (
                  <SelectItem
                    key={status}
                    value={status}
                    data-testid={`people-status-option-${status}`}
                  >
                    {statusLabel(status)}{' '}
                    <span className="text-text-muted tnum">
                      {counts[status]}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filters.role}
              onValueChange={(role) => setFilters({ role: role as RoleFilter })}
            >
              <SelectTrigger
                className="w-full min-w-0"
                aria-label={m.admin_users_filter_role_aria()}
                data-testid="people-role-select"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_FILTERS.map((role) => (
                  <SelectItem key={role} value={role}>
                    {roleFilterLabel(role)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="col-span-2 min-w-0">
              {clientSelect({
                className: 'w-full min-w-0',
                testId: 'people-client-filter-phone',
              })}
            </div>
            {filtersActive ? (
              <div className="col-span-2 -ml-2.5 flex justify-start">
                {clearButton}
              </div>
            ) : null}
          </div>

          <div className="hidden flex-col gap-2 sm:flex xl:flex-row xl:items-center">
            <div className="no-scrollbar max-w-full overflow-x-auto">
              <SegmentedControl<StatusFilter>
                aria-label={m.agency_people_filter_status_aria()}
                data-testid="people-status-filter"
                value={filters.status}
                onValueChange={(status) => setFilters({ status })}
                options={STATUS_FILTERS.map((status) => ({
                  value: status,
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      {statusLabel(status)}
                      <span className="text-text-muted tnum">
                        {counts[status]}
                      </span>
                    </span>
                  ),
                  testId: `people-status-filter-${status}`,
                }))}
              />
            </div>
            <div className="no-scrollbar max-w-full overflow-x-auto">
              <SegmentedControl<RoleFilter>
                aria-label={m.admin_users_filter_role_aria()}
                data-testid="people-filter"
                value={filters.role}
                onValueChange={(role) => setFilters({ role })}
                options={ROLE_FILTERS.map((role) => ({
                  value: role,
                  label: roleFilterLabel(role),
                  testId: `people-filter-${role}`,
                }))}
              />
            </div>
          </div>

          {rowCount > 0 ? (
            <div className="flex items-center justify-between gap-3 px-4">
              <label className="flex items-center gap-2.5 text-caption font-medium text-text-secondary">
                <Checkbox
                  className="relative touch-target"
                  checked={
                    allVisibleSelected
                      ? true
                      : someSelected
                        ? 'indeterminate'
                        : false
                  }
                  disabled={people.length === 0}
                  onCheckedChange={(checked) => toggleAll(checked === true)}
                  aria-label={m.agency_people_select_all()}
                  data-testid="people-select-all"
                />
                {m.agency_people_select_all()}
              </label>
              <p
                className="text-caption font-normal text-text-muted tnum"
                aria-live="polite"
                data-testid="people-count"
              >
                {rowCount === 1
                  ? m.agency_people_count_one()
                  : m.agency_people_count({ count: rowCount })}
              </p>
            </div>
          ) : null}

          {invitations.isError ? (
            <QueryError
              title={m.people_invitations_load_error()}
              error={invitations.error}
              onRetry={() => void invitations.refetch()}
              retrying={invitations.isFetching}
            />
          ) : null}

          {rowCount === 0 ? (
            <EmptyState
              size="sm"
              tone="neutral"
              icon={<MagnifyingGlass />}
              title={m.agency_people_no_match_title()}
              description={m.admin_users_empty_filters()}
              action={
                <Button variant="secondary" size="sm" onClick={clearFilters}>
                  {m.admin_users_clear_filters()}
                </Button>
              }
            />
          ) : (
            <InsetList data-testid="people-list" className="min-w-0">
              {people.map((account) => (
                <PersonRow
                  key={account.id}
                  account={account}
                  isSelf={account.id === me.user.id}
                  selected={pickedSet.has(account.id)}
                  onSelectedChange={(on) => toggle(account.id, on)}
                  protectedAdmin={account.id === lastAdminId}
                  onResetLink={() => setResetTarget(account)}
                  onResetLockout={() => setLockoutTarget(account)}
                  onBlockAction={(kind) => setRowAction({ kind, account })}
                />
              ))}
              {pending.map((invitation) => (
                <InvitationRow
                  key={invitation.id}
                  invitation={invitation}
                  onResend={() =>
                    void mutations.resendInvitation
                      .mutateAsync(invitation.id)
                      .then(() => toast.success(m.people_invite_sent_again()))
                      .catch((error) => toast.error(errorMessage(error)))
                  }
                  onCopyLink={() =>
                    void mutations.regenerateLink
                      .mutateAsync(invitation.id)
                      .then((link) =>
                        setRegenerated({ link, email: invitation.email }),
                      )
                      .catch((error) => toast.error(errorMessage(error)))
                  }
                  onRevoke={() => setRevokeTarget(invitation)}
                />
              ))}
            </InsetList>
          )}
        </div>
      )}

      <FloatingBar
        open={picked.length > 0}
        fullWidthOnMobile
        label={m.agency_people_bulk_label()}
        data-testid="people-bulk-bar"
      >
        <FloatingBarLabel data-testid="people-bulk-count">
          {picked.length === 1
            ? m.agency_people_selected_one()
            : m.agency_people_selected({ count: picked.length })}
        </FloatingBarLabel>
        <ClientPicker
          clients={clients.data ?? []}
          onAdd={(picks: ClientPick[], role: MembershipRole) => {
            void runBulk(
              () =>
                mutations.bulkAddToClients.mutateAsync({
                  userIds: picked,
                  organizationIds: picks.map((pick) => pick.organizationId),
                  role,
                }),
              (count) =>
                countedToast(
                  count,
                  m.agency_people_toast_added_one,
                  m.agency_people_toast_added,
                ),
            )
          }}
          align="start"
        >
          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-testid="bulk-add-clients"
          >
            {m.agency_people_bulk_add()}
          </Button>
        </ClientPicker>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => setBulk('block')}
          data-testid="bulk-block"
        >
          {m.agency_people_bulk_block()}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => setBulk('unblock')}
          data-testid="bulk-unblock"
        >
          {m.agency_people_bulk_unblock()}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => setBulk('sign-out')}
          data-testid="bulk-sign-out"
        >
          {m.agency_people_bulk_sign_out()}
        </Button>
        <FloatingBarDivider />
        <Button
          type="button"
          size="sm"
          variant="quiet"
          onClick={clear}
          data-testid="bulk-clear"
        >
          {m.agency_people_bulk_clear()}
        </Button>
      </FloatingBar>

      <ConfirmDialog
        open={bulk !== null}
        onOpenChange={(open) => {
          if (!open) setBulk(null)
        }}
        title={bulkTitle(bulk, picked.length)}
        description={bulkDescription(bulk)}
        confirmLabel={bulkConfirm(bulk, picked.length)}
        variant={bulk === 'unblock' ? 'default' : 'destructive'}
        onConfirm={async () => {
          const userIds = picked
          const kind = bulk
          setBulk(null)
          if (!kind || userIds.length === 0) return
          if (kind === 'block') {
            await runBulk(
              () => mutations.bulkBlock.mutateAsync({ userIds }),
              (count) =>
                countedToast(
                  count,
                  m.agency_people_toast_blocked_one,
                  m.agency_people_toast_blocked,
                ),
            )
          } else if (kind === 'unblock') {
            await runBulk(
              () => mutations.bulkUnblock.mutateAsync(userIds),
              (count) =>
                countedToast(
                  count,
                  m.agency_people_toast_unblocked_one,
                  m.agency_people_toast_unblocked,
                ),
            )
          } else {
            await runBulk(
              () => mutations.bulkSignOut.mutateAsync(userIds),
              (count) =>
                countedToast(
                  count,
                  m.agency_people_toast_signed_out_one,
                  m.agency_people_toast_signed_out,
                ),
            )
          }
        }}
        testId="people-bulk-confirm"
      />

      <ConfirmDialog
        open={resetTarget !== null}
        onOpenChange={(open) => {
          if (!open) setResetTarget(null)
        }}
        title={m.agency_people_reset_title()}
        description={m.agency_people_reset_body({
          name: resetTarget?.name ?? m.admin_users_this_user(),
        })}
        confirmLabel={m.agency_people_reset_confirm()}
        onConfirm={async () => {
          if (!resetTarget) return
          const account = resetTarget
          try {
            const result = await mutations.sendResetLink.mutateAsync(account.id)
            if (!result.ok) {
              toast.error(result.message, {
                description: result.ref
                  ? m.agency_mail_reference({ id: result.ref })
                  : undefined,
              })
              return
            }
            toast.success(resetLinkSentMessage(result.status, account))
          } catch (error) {
            toast.error(errorMessage(error))
          }
        }}
        testId="send-reset-link-dialog"
      />

      <ConfirmDialog
        open={lockoutTarget !== null}
        onOpenChange={(open) => {
          if (!open) setLockoutTarget(null)
        }}
        title={m.account_factor_lockout_reset()}
        description={m.account_factor_lockout_reset_description()}
        confirmLabel={m.account_factor_lockout_reset()}
        onConfirm={async () => {
          if (!lockoutTarget) return
          try {
            await mutations.resetLockout.mutateAsync(lockoutTarget.id)
            toast.success(m.account_factor_lockout_reset_success())
          } catch (error) {
            toast.error(errorMessage(error))
          }
        }}
        testId="reset-factor-lockout-dialog"
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
        onConfirm={async () => {
          if (!revokeTarget) return
          try {
            await mutations.revokeInvitation.mutateAsync(revokeTarget.id)
            toast.success(m.admin_members_toast_revoked())
          } catch (error) {
            toast.error(errorMessage(error))
          }
        }}
        testId="revoke-invitation-dialog"
      />

      <BlockPersonDialog
        open={rowAction?.kind === 'block'}
        onClose={() => setRowAction(null)}
        userId={rowAction?.account.id ?? ''}
        name={rowAction?.account.name ?? ''}
      />

      <ConfirmDialog
        open={rowAction?.kind === 'unblock'}
        onOpenChange={(open) => {
          if (!open) setRowAction(null)
        }}
        title={m.agency_person_unblock_title({
          name: rowAction?.account.name ?? '',
        })}
        description={m.agency_person_unblock_description()}
        confirmLabel={m.agency_person_unblock_confirm({
          name: rowAction?.account.name ?? '',
        })}
        onConfirm={async () => {
          if (!rowAction) return
          const { account } = rowAction
          try {
            await mutations.unblock.mutateAsync(account.id)
            toast.success(
              m.agency_person_toast_unblocked({ name: account.name }),
            )
          } catch (error) {
            toast.error(errorMessage(error))
          }
        }}
        testId="people-row-unblock-dialog"
      />

      <ConfirmDialog
        open={rowAction?.kind === 'sign-out'}
        onOpenChange={(open) => {
          if (!open) setRowAction(null)
        }}
        title={m.agency_person_sign_out_title({
          name: rowAction?.account.name ?? '',
        })}
        description={m.agency_person_sign_out_description()}
        confirmLabel={m.agency_person_sign_out_confirm()}
        variant="destructive"
        onConfirm={async () => {
          if (!rowAction) return
          const { account } = rowAction
          try {
            await mutations.signOutEverywhere.mutateAsync(account.id)
            toast.success(
              m.agency_person_toast_signed_out({ name: account.name }),
            )
          } catch (error) {
            toast.error(errorMessage(error))
          }
        }}
        testId="people-row-sign-out-dialog"
      />

      <RegeneratedLinkDialog
        link={regenerated?.link ?? null}
        email={regenerated?.email ?? ''}
        onClose={() => setRegenerated(null)}
      />

      <InvitePersonSheet
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        clients={clients.data ?? []}
        accounts={allAccounts}
      />
    </div>
  )
}

function statusLabel(status: StatusFilter) {
  switch (status) {
    case 'all':
      return m.agency_people_filter_all()
    case 'active':
      return m.agency_people_filter_active()
    case 'blocked':
      return m.agency_people_filter_blocked()
    case 'invited':
      return m.agency_people_filter_invited()
    case 'two-factor-off':
      return m.agency_people_filter_two_factor_off()
  }
}

function roleFilterLabel(role: RoleFilter) {
  switch (role) {
    case 'all':
      return m.agency_people_filter_everyone()
    case 'agency-admin':
      return m.agency_people_filter_admins()
    case 'owner':
      return m.agency_people_filter_owners()
    case 'editor':
      return m.agency_people_filter_editors()
  }
}

function bulkTitle(
  kind: 'block' | 'unblock' | 'sign-out' | null,
  count: number,
) {
  if (kind === 'block') {
    return count === 1
      ? m.agency_people_bulk_block_title_one()
      : m.agency_people_bulk_block_title({ count })
  }
  if (kind === 'unblock') {
    return count === 1
      ? m.agency_people_bulk_unblock_title_one()
      : m.agency_people_bulk_unblock_title({ count })
  }
  return count === 1
    ? m.agency_people_bulk_sign_out_title_one()
    : m.agency_people_bulk_sign_out_title({ count })
}

function bulkDescription(kind: 'block' | 'unblock' | 'sign-out' | null) {
  if (kind === 'block') return m.agency_people_bulk_block_description()
  if (kind === 'unblock') return m.agency_people_bulk_unblock_description()
  return m.agency_people_bulk_sign_out_description()
}

function bulkConfirm(
  kind: 'block' | 'unblock' | 'sign-out' | null,
  count: number,
) {
  if (kind === 'block') {
    return count === 1
      ? m.agency_people_bulk_block_confirm_one()
      : m.agency_people_bulk_block_confirm({ count })
  }
  if (kind === 'unblock') {
    return count === 1
      ? m.agency_people_bulk_unblock_confirm_one()
      : m.agency_people_bulk_unblock_confirm({ count })
  }
  return count === 1
    ? m.agency_people_bulk_sign_out_confirm_one()
    : m.agency_people_bulk_sign_out_confirm({ count })
}

/** "Blocked 1 person" or "Blocked 3 people", from the count. */
function countedToast(
  count: number,
  one: () => string,
  many: (params: { count: number }) => string,
) {
  return count === 1 ? one() : many({ count })
}

/** The success toast says what happened to the link: sent, queued, or the provider pointer. */
function resetLinkSentMessage(
  status: 'sent' | 'queued' | 'sso',
  account: AccountRow,
) {
  if (status === 'sso') return m.agency_people_reset_sso({ name: account.name })
  if (status === 'queued') {
    return m.agency_people_reset_queued({ email: account.email })
  }
  return m.agency_people_reset_sent({ email: account.email })
}

function PeopleSkeleton() {
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

function PersonRow({
  account,
  isSelf,
  selected,
  onSelectedChange,
  protectedAdmin,
  onResetLink,
  onResetLockout,
  onBlockAction,
}: {
  account: AccountRow
  isSelf: boolean
  selected: boolean
  onSelectedChange: (on: boolean) => void
  /** The last active agency admin: cannot be blocked. */
  protectedAdmin: boolean
  onResetLink: () => void
  onResetLockout: () => void
  onBlockAction: (kind: 'block' | 'unblock' | 'sign-out') => void
}) {
  const blocked = account.status === 'blocked'
  const lastActive = formatRelativeTime(account.lastActiveAt, { withinDays: 7 })
  const lastActiveLabel = account.lastActiveAt
    ? m.agency_people_last_active({ when: lastActive })
    : m.agency_people_never_active()
  return (
    <li
      className={cn(ROW_CLASS, selected && 'bg-accent-soft/40')}
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
        className="flex min-w-0 flex-1 items-center gap-3 py-3 pr-2 pl-3 outline-none focus-visible:bg-surface-state-hover hover:bg-surface-state-hover"
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
                {m.agency_people_open_profile()}
              </Link>
            </DropdownMenuItem>
            {isSelf ? null : (
              <>
                <DropdownMenuItem
                  onSelect={onResetLink}
                  data-testid={`send-reset-link-${account.email}`}
                >
                  <Key />
                  {m.agency_people_reset_action()}
                </DropdownMenuItem>
                {blocked ? (
                  <DropdownMenuItem
                    onSelect={() => onBlockAction('unblock')}
                    data-testid={`unblock-${account.email}`}
                  >
                    {m.agency_people_menu_unblock()}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    disabled={protectedAdmin}
                    onSelect={() => onBlockAction('block')}
                    data-testid={`block-${account.email}`}
                  >
                    {m.agency_people_menu_block()}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onSelect={() => onBlockAction('sign-out')}
                  data-testid={`sign-out-${account.email}`}
                >
                  {m.agency_person_sign_out_action()}
                </DropdownMenuItem>
              </>
            )}
            {account.isAgencyAdmin && account.factorLockedUntil && !isSelf ? (
              <DropdownMenuItem
                onSelect={onResetLockout}
                data-testid={`reset-factor-lockout-${account.email}`}
              >
                {m.account_factor_lockout_reset()}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </li>
  )
}

function InvitationRow({
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
