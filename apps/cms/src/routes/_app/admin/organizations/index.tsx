import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
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
import { m } from '#/paraglide/messages'
import { createOrganizationFn, listOrganizationsFn } from '#/server/fn/admin'
import { Buildings, Plus, MagnifyingGlass } from '@phosphor-icons/react'

export const Route = createFileRoute('/_app/admin/organizations/')({
  component: OrganizationsPage,
})

type OrgRow = Awaited<ReturnType<typeof listOrganizationsFn>>[number]

const helper = createDataColumns<OrgRow>()

const columns = helper.columns([
  helper.accessor('name', {
    header: () => m.admin_name(),
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
    header: () => m.admin_slug(),
    cell: ({ row }) => (
      <span className="font-mono text-xs text-muted-foreground">
        {row.original.slug}
      </span>
    ),
  }),
  helper.accessor('siteCount', {
    header: () => m.admin_organizations_col_sites(),
    sortFn: 'basic',
    cell: ({ row }) => (
      <span className="tabular-nums">{row.original.siteCount}</span>
    ),
  }),
  helper.accessor('memberCount', {
    header: () => m.admin_organizations_col_members(),
    sortFn: 'basic',
    cell: ({ row }) => (
      <span className="tabular-nums">{row.original.memberCount}</span>
    ),
  }),
  helper.accessor('createdAt', {
    header: () => m.admin_organizations_col_created(),
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
      toast.success(m.admin_organizations_toast_created())
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
          title={m.admin_organizations_title()}
          description={m.admin_organizations_description()}
          actions={
            <DialogTrigger asChild>
              <Button type="button" data-testid="new-organization">
                <Plus />
                {m.admin_organizations_new()}
              </Button>
            </DialogTrigger>
          }
        />

        {orgsQuery.isError ? (
          <QueryError
            title={m.admin_organizations_load_error()}
            error={orgsQuery.error}
            onRetry={() => void orgsQuery.refetch()}
            retrying={orgsQuery.isFetching}
          />
        ) : orgsQuery.isPending ? (
          <TableSkeleton columns={5} />
        ) : orgsQuery.data.length === 0 ? (
          <EmptyState
            icon={<Buildings />}
            title={m.admin_organizations_empty_title()}
            description={m.admin_organizations_empty_description()}
            action={
              open ? undefined : (
                <Button type="button" onClick={() => setOpen(true)}>
                  <Plus />
                  {m.admin_organizations_new()}
                </Button>
              )
            }
          />
        ) : (
          <div className="grid gap-4">
            <div className="grid max-w-sm gap-2">
              <Label htmlFor="org-search" className="sr-only">
                {m.admin_organizations_search_label()}
              </Label>
              <div className="relative">
                <MagnifyingGlass className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="org-search"
                  type="search"
                  placeholder={m.admin_organizations_search_placeholder()}
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
              emptyMessage={m.admin_organizations_empty_filters({
                search: search.trim(),
              })}
              caption={m.admin_organizations_caption()}
            />
          </div>
        )}

        <DialogContent>
          <form className="grid gap-4" onSubmit={onCreate}>
            <DialogHeader>
              <DialogTitle>{m.admin_organizations_dialog_title()}</DialogTitle>
              <DialogDescription>
                {m.admin_organizations_dialog_description()}
              </DialogDescription>
            </DialogHeader>
            <FormField label={m.admin_name()} htmlFor="org-name">
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
            <FormField label={m.admin_slug()} htmlFor="org-slug">
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
                {m.admin_cancel()}
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending
                  ? m.admin_creating()
                  : m.admin_organizations_create()}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </div>
    </Dialog>
  )
}
