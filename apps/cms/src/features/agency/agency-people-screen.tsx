import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { MagnifyingGlass, Plus, Users } from '@phosphor-icons/react'
import { toast } from 'sonner'

import { errorMessage } from '#/lib/admin/helpers'
import { ClientPicker } from '#/features/agency/client-picker'
import { InvitePersonSheet } from '#/features/agency/invite-person-sheet'
import { usePeopleMutations } from '#/features/agency/use-people-mutations'
import {
  ALL_CLIENTS,
  countByStatus,
  filterAccounts,
  filterInvitations,
} from '#/features/agency/people-list'
import type { PeopleFilters } from '#/features/agency/people-list'
import { isLastActiveAdmin } from '#/features/agency/person/person-facts'
import { useShortcut } from '#/components/shell/shortcuts'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { EmptyState } from '#/components/ui/empty-state'
import {
  FloatingBar,
  FloatingBarDivider,
  FloatingBarLabel,
} from '#/components/ui/floating-bar'
import { InsetList } from '#/components/ui/inset-list'
import { PageHeader } from '#/components/ui/page-header'
import { QueryError } from '#/components/ui/query-error'
import { cn } from '#/lib/utils'
import { useDebouncedValue } from '#/hooks/use-debounced-value'
import { useSelection } from '#/hooks/use-selection'
import { m } from '#/paraglide/messages'
import type { Me } from '#/server/fn/me'
import type { BulkResult } from '#/server/admin/users'
import type { MembershipRole } from '#/lib/types'

import { accountsQuery, clientsQuery, pendingInvitationsQuery } from './queries'
import type { ClientPick } from './person/access-stage'
import { BULK, PeopleDialogs, counted } from './people-dialogs'
import type { BulkAction, PeopleDialog } from './people-dialogs'
import { PeopleFilterBar } from './people-filters'
import { InvitationRow, PeopleSkeleton, PersonRow } from './people-rows'

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
  const [inviteOpen, setInviteOpen] = React.useState(false)
  // The last dialog stays set while it animates closed.
  const [dialog, setDialog] = React.useState<PeopleDialog | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)

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

  // Selection only ever covers the people on screen.
  const visibleIds = React.useMemo(
    () => people.map((person) => person.id),
    [people],
  )
  const { picked, isSelected, toggle, toggleAll, clear } =
    useSelection(visibleIds)
  const names = React.useMemo(
    () => new Map(allAccounts.map((account) => [account.id, account.name])),
    [allAccounts],
  )

  // Escape clears the selection; an open overlay handles its own Escape first.
  useShortcut('escape', clear, { enabled: picked.length > 0 })

  React.useEffect(() => {
    if (settledSearch !== filters.search) {
      onFiltersChange({ ...filters, search: settledSearch })
    }
  }, [settledSearch, filters, onFiltersChange])

  function openDialog(next: PeopleDialog) {
    setDialog(next)
    setDialogOpen(true)
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

  const allVisibleSelected =
    people.length > 0 && picked.length === people.length
  const someSelected = picked.length > 0 && !allVisibleSelected

  /** Runs a bulk action, then reports what happened, and who was skipped and why. */
  async function runBulk(
    action: () => Promise<BulkResult>,
    done: (count: number) => string,
  ) {
    let result: BulkResult
    try {
      result = await action()
    } catch (error) {
      toast.error(errorMessage(error))
      return
    }
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

  async function confirmBulk(action: BulkAction) {
    const userIds = picked
    if (userIds.length === 0) return
    const bulk = BULK[action]
    await runBulk(() => bulk.run(mutations, userIds), bulk.done)
  }

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
          <PeopleFilterBar
            filters={filters}
            onFiltersChange={(patch) =>
              onFiltersChange({ ...filters, ...patch })
            }
            search={draftSearch}
            onSearchChange={setDraftSearch}
            onClear={clearFilters}
            counts={counts}
            clients={clients.data ?? []}
          />

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
                  selected={isSelected(account.id)}
                  onSelectedChange={(on) => toggle(account.id, on)}
                  protectedAdmin={account.id === lastAdminId}
                  onAction={(kind) => openDialog({ kind, target: account })}
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
                        openDialog({
                          kind: 'link',
                          link,
                          email: invitation.email,
                        }),
                      )
                      .catch((error) => toast.error(errorMessage(error)))
                  }
                  onRevoke={() =>
                    openDialog({
                      kind: 'revoke',
                      target: {
                        id: invitation.id,
                        name: invitation.email,
                        email: invitation.email,
                      },
                    })
                  }
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
                counted(
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
        {BULK_ACTIONS.map((action) => (
          <Button
            key={action}
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => openDialog({ kind: 'bulk', action })}
            data-testid={`bulk-${action}`}
          >
            {BULK[action].label()}
          </Button>
        ))}
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

      <PeopleDialogs
        dialog={dialog}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        mutations={mutations}
        pickedCount={picked.length}
        onConfirmBulk={confirmBulk}
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

const BULK_ACTIONS = Object.keys(BULK) as BulkAction[]
