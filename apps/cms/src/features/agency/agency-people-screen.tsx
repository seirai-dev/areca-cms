import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MagnifyingGlass, Users, X } from '@phosphor-icons/react'
import { toast } from 'sonner'

import {
  adminQueryKeys,
  errorMessage,
  membershipRoleLabel,
} from '#/components/admin/helpers'
import { UserAvatar } from '#/components/ui/avatar'
import { Tag } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { ConfirmDialog } from '#/components/ui/confirm-dialog'
import { EmptyState } from '#/components/ui/empty-state'
import { InsetList, InsetRow } from '#/components/ui/inset-list'
import { Input } from '#/components/ui/input'
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
import { Switch } from '#/components/ui/switch'
import { RelativeTime } from '#/components/ui/timeline'
import { Hint } from '#/components/ui/tooltip'
import { m } from '#/paraglide/messages'
import type { Me } from '#/server/fn/me'
import { setAgencyAdminFn } from '#/server/fn/admin'

import { accountsQuery } from './queries'
import type { AccountRow } from './queries'

export type RoleFilter = 'all' | 'agency-admin' | 'owner' | 'editor'
const ALL = 'all'

/** Filter everyone with an account by name/email, access and client. */
export function filterAccounts(
  accounts: AccountRow[],
  {
    search,
    role,
    clientId,
  }: { search: string; role: RoleFilter; clientId: string },
) {
  const needle = search.trim().toLowerCase()
  return accounts.filter((account) => {
    if (
      needle &&
      !account.name.toLowerCase().includes(needle) &&
      !account.email.toLowerCase().includes(needle)
    ) {
      return false
    }
    const inClient =
      clientId === ALL
        ? account.memberships
        : account.memberships.filter((item) => item.organizationId === clientId)
    if (clientId !== ALL && inClient.length === 0) return false
    if (role === 'all') return true
    if (role === 'agency-admin') return account.isAgencyAdmin
    return inClient.some((item) => item.role === role)
  })
}

/** Everyone with an account, and the agency-access switch (with confirm). */
function useAgencyPeople() {
  const queryClient = useQueryClient()
  const accounts = useQuery(accountsQuery())
  const [pending, setPending] = React.useState<{
    userId: string
    name: string
    next: boolean
  } | null>(null)
  const mutation = useMutation({
    mutationFn: (input: { userId: string; isAgencyAdmin: boolean }) =>
      setAgencyAdminFn({ data: input }),
    onSuccess: async (_result, input) => {
      toast.success(
        input.isAgencyAdmin
          ? m.admin_users_toast_granted()
          : m.admin_users_toast_removed(),
      )
      setPending(null)
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.users })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  return { accounts, pending, setPending, mutation }
}

/**
 * `/agency/people` (brief §3.11): search, filter pills (Everyone · Agency
 * admins · Owners · Editors) combined with a client menu, and a row per
 * person with their client memberships and an Agency access switch.
 */
export function AgencyPeopleScreen({ me }: { me: Me }) {
  const { accounts, pending, setPending, mutation } = useAgencyPeople()
  const [search, setSearch] = React.useState('')
  const [role, setRole] = React.useState<RoleFilter>('all')
  const [clientId, setClientId] = React.useState(ALL)

  const clients = React.useMemo(() => {
    const byId = new Map<string, string>()
    for (const account of accounts.data ?? []) {
      for (const item of account.memberships)
        byId.set(item.organizationId, item.organizationName)
    }
    return [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [accounts.data])

  const rows = React.useMemo(
    () =>
      filterAccounts(accounts.data ?? [], { search, role, clientId }).sort(
        (a, b) => a.name.localeCompare(b.name),
      ),
    [accounts.data, search, role, clientId],
  )
  const filtersActive =
    search.trim() !== '' || role !== 'all' || clientId !== ALL

  function clear() {
    setSearch('')
    setRole('all')
    setClientId(ALL)
  }

  return (
    <div className="grid gap-8" data-testid="agency-people">
      <PageHeader
        title={m.shell_nav_people()}
        description={m.agency_people_description()}
      />

      {accounts.isError ? (
        <QueryError
          title={m.agency_people_load_error()}
          error={accounts.error}
          onRetry={() => void accounts.refetch()}
          retrying={accounts.isFetching}
        />
      ) : accounts.isPending ? (
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
                <Skeleton className="size-10 rounded-full" />
                <div className="grid flex-1 gap-2">
                  <Skeleton className="h-3.5 w-40" />
                  <Skeleton className="h-3 w-56" />
                </div>
                <Skeleton className="h-6 w-[42px] rounded-full" />
              </div>
            ))}
          </div>
        </div>
      ) : accounts.data.length === 0 ? (
        <EmptyState
          card
          icon={<Users weight="duotone" />}
          title={m.admin_users_empty_title()}
          description={m.admin_users_empty_description()}
        />
      ) : (
        <div className="grid gap-4">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="relative w-full lg:max-w-xs">
              <MagnifyingGlass className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-icon-muted" />
              <Input
                id="user-search"
                type="search"
                aria-label={m.admin_users_search_label()}
                placeholder={m.admin_users_search_placeholder()}
                className="pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                data-shortcut-search
              />
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <div className="no-scrollbar max-w-full overflow-x-auto">
                <SegmentedControl
                  aria-label={m.admin_users_filter_role_aria()}
                  data-testid="people-filter"
                  value={role}
                  onValueChange={setRole}
                  options={[
                    {
                      value: 'all',
                      label: m.agency_people_filter_everyone(),
                      testId: 'people-filter-all',
                    },
                    {
                      value: 'agency-admin',
                      label: m.agency_people_filter_admins(),
                      testId: 'people-filter-agency-admin',
                    },
                    {
                      value: 'owner',
                      label: m.agency_people_filter_owners(),
                      testId: 'people-filter-owner',
                    },
                    {
                      value: 'editor',
                      label: m.agency_people_filter_editors(),
                      testId: 'people-filter-editor',
                    },
                  ]}
                />
              </div>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger
                  className="w-44"
                  aria-label={m.activity_filter_client()}
                  data-testid="people-client-filter"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>
                    {m.activity_all_clients()}
                  </SelectItem>
                  {clients.map((client) => (
                    <SelectItem key={client.id} value={client.id}>
                      {client.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {filtersActive ? (
                <Button
                  type="button"
                  variant="quiet"
                  size="sm"
                  onClick={clear}
                  data-testid="people-clear-filters"
                >
                  <X />
                  {m.admin_users_clear_filters()}
                </Button>
              ) : null}
            </div>
          </div>

          <p
            className="px-1 text-caption font-normal text-text-muted tnum"
            aria-live="polite"
          >
            {rows.length === 1
              ? m.agency_people_count_one()
              : m.agency_people_count({ count: rows.length })}
          </p>

          {rows.length === 0 ? (
            <EmptyState
              size="sm"
              tone="neutral"
              icon={<MagnifyingGlass />}
              title={m.home_no_results_title()}
              description={m.admin_users_empty_filters()}
              action={
                <Button variant="secondary" size="sm" onClick={clear}>
                  {m.admin_users_clear_filters()}
                </Button>
              }
            />
          ) : (
            <InsetList data-testid="people-list">
              {rows.map((account) => (
                <PersonRow
                  key={account.id}
                  account={account}
                  isSelf={account.id === me.user.id}
                  onToggle={(next) =>
                    setPending({ userId: account.id, name: account.name, next })
                  }
                />
              ))}
            </InsetList>
          )}
        </div>
      )}

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
        title={
          pending?.next
            ? m.admin_users_confirm_grant_title({ name: pending.name })
            : m.admin_users_confirm_revoke_title({
                name: pending?.name ?? m.admin_users_this_user(),
              })
        }
        description={
          pending?.next
            ? m.admin_users_confirm_grant_description()
            : m.admin_users_confirm_revoke_description()
        }
        confirmLabel={
          pending?.next
            ? m.admin_users_confirm_grant_label()
            : m.admin_users_confirm_revoke_label()
        }
        variant={pending?.next ? 'default' : 'destructive'}
        onConfirm={async () => {
          if (!pending) return
          await mutation.mutateAsync({
            userId: pending.userId,
            isAgencyAdmin: pending.next,
          })
        }}
        testId="agency-access-confirm"
      />
    </div>
  )
}

function PersonRow({
  account,
  isSelf,
  onToggle,
}: {
  account: AccountRow
  isSelf: boolean
  onToggle: (next: boolean) => void
}) {
  const switchId = `agency-access-${account.id}`
  const toggle = (
    <Switch
      id={switchId}
      checked={account.isAgencyAdmin}
      disabled={isSelf}
      onCheckedChange={(next) => onToggle(next)}
      aria-label={m.admin_users_aria_agency_admin({ email: account.email })}
      data-testid={`agency-access-${account.email}`}
    />
  )
  return (
    <InsetRow
      data-testid={`person-row-${account.email}`}
      className="min-h-[68px] items-start py-3 sm:items-center"
      leading={<UserAvatar name={account.name} size="lg" />}
      title={
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{account.name}</span>
          {isSelf ? <Tag tone="accent">{m.admin_you()}</Tag> : null}
        </span>
      }
      subtitle={account.email}
      trailing={
        <label
          htmlFor={isSelf ? undefined : switchId}
          className="flex items-center gap-2.5"
        >
          <span className="hidden text-callout text-text-secondary md:inline">
            {m.agency_people_access()}
          </span>
          {isSelf ? (
            <Hint label={m.admin_users_self_tooltip()} wrapDisabled>
              {toggle}
            </Hint>
          ) : (
            toggle
          )}
        </label>
      }
    >
      <span className="mt-1 flex flex-wrap items-center gap-1.5">
        {account.memberships.length === 0 ? (
          <span className="text-caption font-normal text-text-muted">
            {m.agency_people_no_clients()}
          </span>
        ) : (
          account.memberships.map((item) => (
            <span
              key={item.organizationId}
              className="inline-flex h-[22px] items-center gap-1 rounded-full border border-border-default bg-background-subtle px-2 text-[12px] leading-4 font-medium text-text-primary"
              data-testid="membership-chip"
            >
              {item.organizationName}
              <span className="text-text-muted">
                · {membershipRoleLabel(item.role)}
              </span>
            </span>
          ))
        )}
        <span className="text-caption font-normal text-text-muted">
          {m.agency_people_joined()} <RelativeTime value={account.createdAt} />
        </span>
      </span>
    </InsetRow>
  )
}
