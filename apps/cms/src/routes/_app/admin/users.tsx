import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { Search, Users } from 'lucide-react'
import { toast } from 'sonner'

import {
  adminQueryKeys,
  errorMessage,
  formatDate,
} from '#/components/admin/helpers'
import { TableSkeleton } from '#/components/admin/table-skeleton'
import { ConfirmDialog } from '#/components/confirm-dialog'
import { createDataColumns, DataTable } from '#/components/data-table'
import { EmptyState } from '#/components/empty-state'
import { PageHeader } from '#/components/page-header'
import { QueryError } from '#/components/query-error'
import { Badge } from '#/components/ui/badge'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Switch } from '#/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import { listUsersFn, setAgencyAdminFn } from '#/server/fn/admin'

export const Route = createFileRoute('/_app/admin/users')({
  component: UsersPage,
})

type UserRow = Awaited<ReturnType<typeof listUsersFn>>[number]

const helper = createDataColumns<UserRow>()

function UsersPage() {
  const { me } = Route.useRouteContext()
  const queryClient = useQueryClient()
  const listUsers = useServerFn(listUsersFn)
  const setAgencyAdmin = useServerFn(setAgencyAdminFn)
  const [search, setSearch] = useState('')
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
        input.isAgencyAdmin ? 'Agency admin granted' : 'Agency admin removed',
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
          header: 'Name',
          cell: ({ row }) => (
            <span className="flex items-center gap-2">
              <span className="font-medium">{row.original.name}</span>
              {row.original.id === selfId ? (
                <Badge variant="secondary">You</Badge>
              ) : null}
            </span>
          ),
        }),
        helper.accessor('email', {
          header: 'Email',
          cell: ({ row }) => (
            <span className="text-muted-foreground">{row.original.email}</span>
          ),
        }),
        helper.accessor('createdAt', {
          header: 'Joined',
          sortFn: 'datetime',
          cell: ({ row }) => (
            <span className="whitespace-nowrap text-muted-foreground">
              {formatDate(row.original.createdAt)}
            </span>
          ),
        }),
        helper.accessor('isAgencyAdmin', {
          header: 'Agency admin',
          cell: ({ row }) => {
            const user = row.original
            const isSelf = user.id === selfId
            const control = (
              <Switch
                checked={user.isAgencyAdmin}
                disabled={isSelf}
                aria-label={`Agency admin for ${user.email}`}
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
                <TooltipContent>
                  You can&apos;t change your own access.
                </TooltipContent>
              </Tooltip>
            )
          },
        }),
      ]),
    [selfId],
  )

  const filtered = useMemo(() => {
    const users = usersQuery.data ?? []
    const needle = search.trim().toLowerCase()
    if (!needle) {
      return users
    }
    return users.filter(
      (user) =>
        user.name.toLowerCase().includes(needle) ||
        user.email.toLowerCase().includes(needle),
    )
  }, [usersQuery.data, search])

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Users"
        description="Everyone with an account. Agency admins can manage every organization, site, and user."
      />

      {usersQuery.isError ? (
        <QueryError
          title="Could not load users"
          error={usersQuery.error}
          onRetry={() => void usersQuery.refetch()}
          retrying={usersQuery.isFetching}
        />
      ) : usersQuery.isPending ? (
        <TableSkeleton columns={4} />
      ) : usersQuery.data.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title="No users yet"
          description="Accounts are created when someone accepts an invitation or signs up."
        />
      ) : (
        <div className="grid gap-4">
          <div className="grid max-w-sm gap-2">
            <Label htmlFor="user-search" className="sr-only">
              Search users
            </Label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="user-search"
                type="search"
                placeholder="Search by name or email"
                className="pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>
          <DataTable
            columns={columns}
            data={filtered}
            pageSize={25}
            initialSorting={[{ id: 'name', desc: false }]}
            emptyMessage={`No users match “${search.trim()}”.`}
            caption="Users"
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
            ? `Make ${pending.name} an agency admin?`
            : `Remove agency admin from ${pending?.name ?? 'this user'}?`
        }
        description={
          pending?.next
            ? 'Agency admins can manage every organization, site, and user.'
            : 'They will lose access to the agency area and every organization they are not a member of.'
        }
        confirmLabel={pending?.next ? 'Make admin' : 'Remove admin'}
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
