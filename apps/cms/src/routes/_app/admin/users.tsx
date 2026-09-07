import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { toast } from 'sonner'

import { adminQueryKeys, errorMessage } from '#/components/admin/helpers'
import { TableSkeleton } from '#/components/admin/table-skeleton'
import { ConfirmDialog } from '#/components/confirm-dialog'
import { EmptyState } from '#/components/empty-state'
import { PageHeader } from '#/components/page-header'
import { Switch } from '#/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { listUsersFn, setAgencyAdminFn } from '#/server/fn/admin'

export const Route = createFileRoute('/_app/admin/users')({
  component: UsersPage,
})

function UsersPage() {
  const { me } = Route.useRouteContext()
  const queryClient = useQueryClient()
  const listUsers = useServerFn(listUsersFn)
  const setAgencyAdmin = useServerFn(setAgencyAdminFn)
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
    onSuccess: async () => {
      toast.success('Agency admin updated')
      setPending(null)
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.users })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  return (
    <div className="grid gap-6">
      <PageHeader title="Users" description="Promote or demote agency admins." />
      {usersQuery.isLoading ? (
        <TableSkeleton />
      ) : usersQuery.data?.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Agency admin</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {usersQuery.data.map((user) => {
              const isSelf = user.id === me.user.id
              return (
                <TableRow key={user.id}>
                  <TableCell>{user.name}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    <Switch
                      checked={user.isAgencyAdmin}
                      disabled={isSelf}
                      aria-label={`Agency admin for ${user.email}`}
                      onCheckedChange={(next) => {
                        if (isSelf) {
                          return
                        }
                        setPending({
                          userId: user.id,
                          name: user.name,
                          next,
                        })
                      }}
                    />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      ) : (
        <EmptyState title="No users" />
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
        description="Agency admins can manage every organization, site, and user."
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
