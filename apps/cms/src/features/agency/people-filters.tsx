import { MagnifyingGlass, X } from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { SegmentedControl } from '#/components/ui/segmented-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { m } from '#/paraglide/messages'

import {
  ALL_CLIENTS,
  ROLE_FILTERS,
  STATUS_FILTERS,
  hasActiveFilters,
} from './people-list'
import type { PeopleFilters, RoleFilter, StatusFilter } from './people-list'

/** Search, status, role and client filters for the People list. */
export function PeopleFilterBar({
  filters,
  onFiltersChange,
  search,
  onSearchChange,
  onClear,
  counts,
  clients,
}: {
  filters: PeopleFilters
  onFiltersChange: (patch: Partial<PeopleFilters>) => void
  /** The search box's draft; the URL gets the settled value. */
  search: string
  onSearchChange: (search: string) => void
  onClear: () => void
  counts: Record<StatusFilter, number>
  clients: { id: string; name: string }[]
}) {
  const setFilters = onFiltersChange
  const filtersActive = hasActiveFilters(filters)

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
        {clients.map((client) => (
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
      onClick={onClear}
      data-testid="people-clear-filters"
    >
      <X />
      {m.admin_users_clear_filters()}
    </Button>
  ) : null

  return (
    <>
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
            onChange={(event) => onSearchChange(event.target.value)}
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
                <span className="text-text-muted tnum">{counts[status]}</span>
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
                  <span className="text-text-muted tnum">{counts[status]}</span>
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
    </>
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
