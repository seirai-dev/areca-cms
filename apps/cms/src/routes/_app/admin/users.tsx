import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { Search, Users, X } from 'lucide-react'
import { toast } from 'sonner'

import {
  adminQueryKeys,
  errorMessage,
  formatDate,
  membershipRoleLabel,
} from '#/components/admin/helpers'
import { TableSkeleton } from '#/components/admin/table-skeleton'
import { ConfirmDialog } from '#/components/confirm-dialog'
import { createDataColumns, DataTable } from '#/components/data-table'
import { EmptyState } from '#/components/empty-state'
import { PageHeader } from '#/components/page-header'
import { QueryError } from '#/components/query-error'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Switch } from '#/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import { m } from '#/paraglide/messages'
import { listUsersFn, setAgencyAdminFn } from '#/server/fn/admin'

export const Route = createFileRoute('/_app/admin/users')({
  component: UsersPage,
})

type UserRow = Awaited<ReturnType<typeof listUsersFn>>[number]
type RoleFilter = 'all' | 'agency-admin' | 'owner' | 'editor'

const helper = createDataColumns<UserRow>()

function UsersPage() {
  const { me } = Route.useRouteContext()
  const queryClient = useQueryClient()
  const listUsers = useServerFn(listUsersFn)
  const setAgencyAdmin = useServerFn(setAgencyAdminFn)
  const [search, setSearch] = useState('')
  const [orgId, setOrgId] = useState('all')
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all')
  const [pending, setPending] = useState<{
    userId: string
    name: string
    next: boolean
  } | null>(null)

  const usersQuery = useQuery({
    queryKey: adminQueryKeys.users,
    queryFn: () => listUsers(),
  })

  const mutation = useMutation({
    mutationFn: (input: { userId: string; isAgencyAdmin: boolean }) =>
      setAgencyAdmin({ data: input }),
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

  const selfId = me.user.id

  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor('name', {
          header: () => m.admin_name(),
          cell: ({ row }) => (
            <span className="flex items-center gap-2">
              <span className="font-medium">{row.original.name}</span>
              {row.original.id === selfId ? (
                <Badge variant="secondary">{m.admin_you()}</Badge>
              ) : null}
            </span>
          ),
        }),
        helper.accessor('email', {
          header: () => m.admin_email(),
          cell: ({ row }) => (
            <span className="text-muted-foreground">{row.original.email}</span>
          ),
        }),
        helper.accessor(
          (row) =>
            row.memberships
              .map(
                (item) =>
                  `${item.organizationName} ${membershipRoleLabel(item.role)}`,
              )
              .join(', '),
          {
            id: 'organizations',
            header: () => m.admin_users_col_organizations(),
            cell: ({ row }) => {
              const { memberships } = row.original
              if (memberships.length === 0) {
                return <span className="text-muted-foreground">—</span>
              }
              return (
                <div className="flex flex-wrap gap-1">
                  {memberships.map((item) => (
                    <Badge key={item.organizationId} variant="outline">
                      {item.organizationName} · {membershipRoleLabel(item.role)}
                    </Badge>
                  ))}
                </div>
              )
            },
          },
        ),
        helper.accessor('createdAt', {
          header: () => m.admin_users_col_joined(),
          sortFn: 'datetime',
          cell: ({ row }) => (
            <span className="whitespace-nowrap text-muted-foreground">
              {formatDate(row.original.createdAt)}
            </span>
          ),
        }),
        helper.accessor('isAgencyAdmin', {
          header: () => m.admin_users_col_agency_admin(),
          cell: ({ row }) => {
            const user = row.original
            const isSelf = user.id === selfId
            const control = (
              <Switch
                checked={user.isAgencyAdmin}
                disabled={isSelf}
                aria-label={m.admin_users_aria_agency_admin({
                  email: user.email,
                })}
                onCheckedChange={(next) => {
                  if (isSelf) {
                    return
                  }
                  setPending({ userId: user.id, name: user.name, next })
                }}
              />
            )
            if (!isSelf) {
              return control
            }
            return (
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* Disabled controls don't emit pointer events, so the
                      wrapper carries the tooltip and keyboard focus. */}
                  <span tabIndex={0} className="inline-flex rounded-full">
                    {control}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{m.admin_users_self_tooltip()}</TooltipContent>
              </Tooltip>
            )
          },
        }),
      ]),
    [selfId],
  )

  const organizations = useMemo(() => {
    const byId = new Map<string, string>()
    for (const user of usersQuery.data ?? []) {
      for (const item of user.memberships) {
        byId.set(item.organizationId, item.organizationName)
      }
    }
    return [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [usersQuery.data])

  const filtersActive =
    search.trim() !== '' || orgId !== 'all' || roleFilter !== 'all'

  const filtered = useMemo(() => {
    const users = usersQuery.data ?? []
    const needle = search.trim().toLowerCase()
    return users.filter((user) => {
      if (
        needle &&
        !user.name.toLowerCase().includes(needle) &&
        !user.email.toLowerCase().includes(needle)
      ) {
        return false
      }

      const inOrg =
        orgId === 'all'
          ? user.memberships
          : user.memberships.filter((item) => item.organizationId === orgId)
      if (orgId !== 'all' && inOrg.length === 0) {
        return false
      }

      if (roleFilter === 'all') {
        return true
      }
      if (roleFilter === 'agency-admin') {
        return user.isAgencyAdmin
      }
      return inOrg.some((item) => item.role === roleFilter)
    })
  }, [usersQuery.data, search, orgId, roleFilter])

  function clearFilters() {
    setSearch('')
    setOrgId('all')
    setRoleFilter('all')
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title={m.admin_users_title()}
        description={m.admin_users_description()}
      />

      {usersQuery.isError ? (
        <QueryError
          title={m.admin_users_load_error()}
          error={usersQuery.error}
          onRetry={() => void usersQuery.refetch()}
          retrying={usersQuery.isFetching}
        />
      ) : usersQuery.isPending ? (
        <TableSkeleton columns={5} />
      ) : usersQuery.data.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title={m.admin_users_empty_title()}
          description={m.admin_users_empty_description()}
        />
      ) : (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:max-w-xs">
              <Label htmlFor="user-search" className="sr-only">
                {m.admin_users_search_label()}
              </Label>
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="user-search"
                type="search"
                placeholder={m.admin_users_search_placeholder()}
                className="pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <Select value={orgId} onValueChange={setOrgId}>
              <SelectTrigger
                className="w-48"
                aria-label={m.admin_users_filter_org_aria()}
              >
                <SelectValue
                  placeholder={m.admin_users_filter_org_placeholder()}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {m.admin_users_filter_all_orgs()}
                </SelectItem>
                {organizations.map((org) => (
                  <SelectItem key={org.id} value={org.id}>
                    {org.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={roleFilter}
              onValueChange={(value) => setRoleFilter(value as RoleFilter)}
            >
              <SelectTrigger
                className="w-40"
                aria-label={m.admin_users_filter_role_aria()}
              >
                <SelectValue
                  placeholder={m.admin_users_filter_role_placeholder()}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {m.admin_users_filter_all_roles()}
                </SelectItem>
                <SelectItem value="agency-admin">
                  {m.admin_users_filter_agency_admin()}
                </SelectItem>
                <SelectItem value="owner">
                  {membershipRoleLabel('owner')}
                </SelectItem>
                <SelectItem value="editor">
                  {membershipRoleLabel('editor')}
                </SelectItem>
              </SelectContent>
            </Select>
            {filtersActive ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearFilters}
              >
                <X />
                {m.admin_users_clear_filters()}
              </Button>
            ) : null}
          </div>
          <DataTable
            columns={columns}
            data={filtered}
            pageSize={25}
            initialSorting={[{ id: 'name', desc: false }]}
            emptyMessage={m.admin_users_empty_filters()}
            caption={m.admin_users_caption()}
          />
        </div>
      )}

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPending(null)
          }
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
          if (!pending) {
            return
          }
          await mutation.mutateAsync({
            userId: pending.userId,
            isAgencyAdmin: pending.next,
          })
        }}
      />
    </div>
  )
}
