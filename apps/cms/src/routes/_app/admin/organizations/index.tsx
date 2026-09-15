import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { Building2, Plus, Search } from 'lucide-react'
import { toast } from 'sonner'

import {
  adminQueryKeys,
  errorMessage,
  formatDate,
  suggestSlug,
} from '#/components/admin/helpers'
import { TableSkeleton } from '#/components/admin/table-skeleton'
import { createDataColumns, DataTable } from '#/components/data-table'
import { EmptyState } from '#/components/empty-state'
import { FormField } from '#/components/form-field'
import { PageHeader } from '#/components/page-header'
import { QueryError } from '#/components/query-error'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { createOrganizationFn, listOrganizationsFn } from '#/server/fn/admin'

export const Route = createFileRoute('/_app/admin/organizations/')({
  component: OrganizationsPage,
})

type OrgRow = Awaited<ReturnType<typeof listOrganizationsFn>>[number]

const helper = createDataColumns<OrgRow>()

const columns = helper.columns([
  helper.accessor('name', {
    header: 'Name',
    cell: ({ row }) => (
      <Link
        to="/admin/organizations/$orgId"
        params={{ orgId: row.original.id }}
        className="font-medium hover:underline"
      >
        {row.original.name}
      </Link>
    ),
  }),
  helper.accessor('slug', {
    header: 'Slug',
    cell: ({ row }) => (
      <span className="font-mono text-xs text-muted-foreground">
        {row.original.slug}
      </span>
    ),
  }),
  helper.accessor('siteCount', {
    header: 'Sites',
    sortFn: 'basic',
    cell: ({ row }) => (
      <span className="tabular-nums">{row.original.siteCount}</span>
    ),
  }),
  helper.accessor('memberCount', {
    header: 'Members',
    sortFn: 'basic',
    cell: ({ row }) => (
      <span className="tabular-nums">{row.original.memberCount}</span>
    ),
  }),
  helper.accessor('createdAt', {
    header: 'Created',
    sortFn: 'datetime',
    cell: ({ row }) => (
      <span className="whitespace-nowrap text-muted-foreground">
        {formatDate(row.original.createdAt)}
      </span>
    ),
  }),
])

function OrganizationsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const listOrganizations = useServerFn(listOrganizationsFn)
  const createOrganization = useServerFn(createOrganizationFn)

  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [search, setSearch] = useState('')

  const orgsQuery = useQuery({
    queryKey: adminQueryKeys.organizations,
    queryFn: () => listOrganizations(),
  })

  const createMutation = useMutation({
    mutationFn: () => createOrganization({ data: { name, slug } }),
    onSuccess: async (org) => {
      toast.success('Organization created')
      setOpen(false)
      setName('')
      setSlug('')
      setSlugTouched(false)
      await queryClient.invalidateQueries({
        queryKey: adminQueryKeys.organizations,
      })
      await navigate({
        to: '/admin/organizations/$orgId',
        params: { orgId: org.id },
      })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const filtered = useMemo(() => {
    const orgs = orgsQuery.data ?? []
    const needle = search.trim().toLowerCase()
    if (!needle) {
      return orgs
    }
    return orgs.filter(
      (org) =>
        org.name.toLowerCase().includes(needle) ||
        org.slug.toLowerCase().includes(needle),
    )
  }, [orgsQuery.data, search])

  function onNameChange(value: string) {
    setName(value)
    if (!slugTouched) {
      setSlug(suggestSlug(value))
    }
  }

  function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    createMutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div
        className="grid gap-6"
        data-testid="organizations-page"
        data-ready={orgsQuery.isFetched ? 'true' : 'false'}
      >
        <PageHeader
          title="Organizations"
          description="Agency customers and their sites."
          actions={
            <DialogTrigger asChild>
              <Button type="button" data-testid="new-organization">
                <Plus />
                New organization
              </Button>
            </DialogTrigger>
          }
        />

        {orgsQuery.isError ? (
          <QueryError
            title="Could not load organizations"
            error={orgsQuery.error}
            onRetry={() => void orgsQuery.refetch()}
            retrying={orgsQuery.isFetching}
          />
        ) : orgsQuery.isPending ? (
          <TableSkeleton columns={5} />
        ) : orgsQuery.data.length === 0 ? (
          <EmptyState
            icon={<Building2 />}
            title="No organizations yet"
            description="Create an organization to start adding sites and inviting members."
            action={
              open ? undefined : (
                <Button type="button" onClick={() => setOpen(true)}>
                  <Plus />
                  New organization
                </Button>
              )
            }
          />
        ) : (
          <div className="grid gap-4">
            <div className="grid max-w-sm gap-2">
              <Label htmlFor="org-search" className="sr-only">
                Search organizations
              </Label>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="org-search"
                  type="search"
                  placeholder="Search by name or slug"
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
              emptyMessage={`No organizations match “${search.trim()}”.`}
              caption="Organizations"
            />
          </div>
        )}

        <DialogContent>
          <form className="grid gap-4" onSubmit={onCreate}>
            <DialogHeader>
              <DialogTitle>New organization</DialogTitle>
              <DialogDescription>
                The slug is suggested from the name and must be unique. It is
                used in URLs and cannot be changed later.
              </DialogDescription>
            </DialogHeader>
            <FormField label="Name" htmlFor="org-name">
              <Input
                id="org-name"
                data-testid="org-name"
                required
                autoFocus
                autoComplete="organization"
                value={name}
                onChange={(event) => onNameChange(event.target.value)}
              />
            </FormField>
            <FormField label="Slug" htmlFor="org-slug">
              <Input
                id="org-slug"
                data-testid="org-slug"
                required
                autoComplete="off"
                className="font-mono"
                value={slug}
                onChange={(event) => {
                  setSlugTouched(true)
                  setSlug(event.target.value)
                }}
              />
            </FormField>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={createMutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating…' : 'Create organization'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </div>
    </Dialog>
  )
}
