import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Link,
  createFileRoute,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { Globe, Plus } from 'lucide-react'
import { toast } from 'sonner'

import {
  adminQueryKeys,
  errorMessage,
  suggestSlug,
} from '#/components/admin/helpers'
import { OrgMembers } from '#/components/admin/org-members'
import { TableSkeleton } from '#/components/admin/table-skeleton'
import { TokenAlert } from '#/components/admin/token-alert'
import { ConfirmDialog } from '#/components/confirm-dialog'
import { createDataColumns, DataTable } from '#/components/data-table'
import { EmptyState } from '#/components/empty-state'
import { FormField } from '#/components/form-field'
import { PageHeader } from '#/components/page-header'
import { QueryError } from '#/components/query-error'
import { Button, buttonVariants } from '#/components/ui/button'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'
import {
  createSiteFn,
  deleteOrganizationFn,
  listOrganizationsFn,
  listSitesFn,
  updateOrganizationFn,
} from '#/server/fn/admin'

export const Route = createFileRoute('/_app/admin/organizations/$orgId')({
  component: OrganizationDetailPage,
})

type SiteRow = Awaited<ReturnType<typeof listSitesFn>>[number]
type OrgTab = 'sites' | 'members' | 'settings'

const DEFAULT_PRODUCTION_URL = 'http://localhost:3001'

const siteHelper = createDataColumns<SiteRow>()

const siteColumns = siteHelper.columns([
  siteHelper.accessor('name', {
    header: 'Name',
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  }),
  siteHelper.accessor('slug', {
    header: 'Slug',
    cell: ({ row }) => (
      <span className="font-mono text-xs text-muted-foreground">
        {row.original.slug}
      </span>
    ),
  }),
  siteHelper.accessor('productionUrl', {
    header: 'Production URL',
    cell: ({ row }) => (
      <a
        href={row.original.productionUrl}
        target="_blank"
        rel="noreferrer"
        className="text-muted-foreground hover:text-foreground hover:underline"
      >
        {row.original.productionUrl}
      </a>
    ),
  }),
  siteHelper.display({
    id: 'actions',
    header: () => <span className="sr-only">Actions</span>,
    enableSorting: false,
    cell: ({ row }) => (
      <div className="flex justify-end">
        <Link
          to="/sites/$siteId/settings"
          params={{ siteId: row.original.id }}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          Settings
        </Link>
      </div>
    ),
  }),
])

function OrganizationDetailPage() {
  const { orgId } = Route.useParams()
  const navigate = useNavigate()
  const router = useRouter()
  const queryClient = useQueryClient()
  const listOrganizations = useServerFn(listOrganizationsFn)
  const listSites = useServerFn(listSitesFn)
  const createSite = useServerFn(createSiteFn)
  const updateOrganization = useServerFn(updateOrganizationFn)
  const deleteOrganization = useServerFn(deleteOrganizationFn)

  const [tab, setTab] = useState<OrgTab>('sites')
  const [siteOpen, setSiteOpen] = useState(false)
  const [siteName, setSiteName] = useState('')
  const [siteSlug, setSiteSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [productionUrl, setProductionUrl] = useState(DEFAULT_PRODUCTION_URL)
  const [createdToken, setCreatedToken] = useState<string | null>(null)
  const [orgName, setOrgName] = useState('')

  useEffect(() => {
    const stored = sessionStorage.getItem(`areca.site-token.${orgId}`)
    if (stored) {
      setCreatedToken(stored)
    }
  }, [orgId])

  const orgsQuery = useQuery({
    queryKey: adminQueryKeys.organizations,
    queryFn: () => listOrganizations(),
  })
  const sitesQuery = useQuery({
    queryKey: adminQueryKeys.sites(orgId),
    queryFn: () => listSites({ data: { organizationId: orgId } }),
  })

  const org = orgsQuery.data?.find((item) => item.id === orgId)

  // Seed the rename field once the org is known (and whenever it changes
  // after a successful save).
  useEffect(() => {
    if (org) {
      setOrgName(org.name)
    }
  }, [org])

  const createSiteMutation = useMutation({
    mutationFn: () =>
      createSite({
        data: {
          organizationId: orgId,
          name: siteName,
          slug: siteSlug,
          productionUrl,
        },
      }),
    onSuccess: async (site) => {
      toast.success('Site created')
      sessionStorage.setItem(`areca.site-token.${orgId}`, site.token)
      setCreatedToken(site.token)
      setSiteOpen(false)
      setSiteName('')
      setSiteSlug('')
      setSlugTouched(false)
      setProductionUrl(DEFAULT_PRODUCTION_URL)
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: adminQueryKeys.sites(orgId),
        }),
        queryClient.invalidateQueries({
          queryKey: adminQueryKeys.organizations,
        }),
        router.invalidate(),
      ])
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const renameMutation = useMutation({
    mutationFn: () =>
      updateOrganization({ data: { id: orgId, name: orgName.trim() } }),
    onSuccess: async () => {
      toast.success('Organization renamed')
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: adminQueryKeys.organizations,
        }),
        router.invalidate(),
      ])
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteOrganization({ data: { id: orgId } }),
    onSuccess: async () => {
      toast.success('Organization deleted')
      await queryClient.invalidateQueries({
        queryKey: adminQueryKeys.organizations,
      })
      await navigate({ to: '/admin/organizations' })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  if (orgsQuery.isError) {
    return (
      <div className="grid gap-6">
        <QueryError
          title="Could not load this organization"
          error={orgsQuery.error}
          onRetry={() => void orgsQuery.refetch()}
          retrying={orgsQuery.isFetching}
        />
      </div>
    )
  }

  if (orgsQuery.isPending) {
    return (
      <div className="grid gap-6">
        <TableSkeleton columns={4} />
      </div>
    )
  }

  if (!org) {
    return (
      <EmptyState
        title="Organization not found"
        description="It may have been deleted, or the link is out of date."
        action={
          <Link
            to="/admin/organizations"
            className={buttonVariants({ variant: 'outline' })}
          >
            Back to organizations
          </Link>
        }
      />
    )
  }

  function onSiteNameChange(value: string) {
    setSiteName(value)
    if (!slugTouched) {
      setSiteSlug(suggestSlug(value))
    }
  }

  function onCreateSite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    createSiteMutation.mutate()
  }

  function onRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    renameMutation.mutate()
  }

  const siteCount = Math.max(org.siteCount, sitesQuery.data?.length ?? 0)
  const hasSites = siteCount > 0
  const renameDirty = orgName.trim().length > 0 && orgName.trim() !== org.name

  return (
    <div
      className="grid gap-6"
      data-testid="organization-page"
      data-ready="true"
    >
      <PageHeader title={org.name} description={org.slug} />
      {createdToken ? (
        <TokenAlert
          token={createdToken}
          onDismiss={() => {
            sessionStorage.removeItem(`areca.site-token.${orgId}`)
            setCreatedToken(null)
          }}
        />
      ) : null}

      <Tabs value={tab} onValueChange={(value) => setTab(value as OrgTab)}>
        <TabsList>
          <TabsTrigger value="sites">Sites</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="sites" className="grid gap-4 pt-4">
          <Dialog open={siteOpen} onOpenChange={setSiteOpen}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-medium">Sites</h2>
              <DialogTrigger asChild>
                <Button type="button" data-testid="new-site">
                  <Plus />
                  New site
                </Button>
              </DialogTrigger>
            </div>
            {sitesQuery.isError ? (
              <QueryError
                title="Could not load sites"
                error={sitesQuery.error}
                onRetry={() => void sitesQuery.refetch()}
                retrying={sitesQuery.isFetching}
              />
            ) : sitesQuery.isPending ? (
              <TableSkeleton columns={4} />
            ) : sitesQuery.data.length === 0 ? (
              <EmptyState
                icon={<Globe />}
                title="No sites yet"
                description="Create a site to get a site token for the SDK and start syncing content."
                action={
                  siteOpen ? undefined : (
                    <Button type="button" onClick={() => setSiteOpen(true)}>
                      <Plus />
                      New site
                    </Button>
                  )
                }
              />
            ) : (
              <DataTable
                columns={siteColumns}
                data={sitesQuery.data}
                pageSize={25}
                initialSorting={[{ id: 'name', desc: false }]}
                caption={`Sites in ${org.name}`}
              />
            )}
            <DialogContent>
              <form className="grid gap-4" onSubmit={onCreateSite}>
                <DialogHeader>
                  <DialogTitle>New site</DialogTitle>
                  <DialogDescription>
                    The site token is shown once after creation. For the local
                    demo site use {DEFAULT_PRODUCTION_URL} as the production
                    URL.
                  </DialogDescription>
                </DialogHeader>
                <FormField label="Name" htmlFor="site-name">
                  <Input
                    id="site-name"
                    data-testid="site-name"
                    required
                    autoFocus
                    autoComplete="off"
                    value={siteName}
                    onChange={(event) => onSiteNameChange(event.target.value)}
                  />
                </FormField>
                <FormField label="Slug" htmlFor="site-slug">
                  <Input
                    id="site-slug"
                    data-testid="site-slug"
                    required
                    autoComplete="off"
                    className="font-mono"
                    value={siteSlug}
                    onChange={(event) => {
                      setSlugTouched(true)
                      setSiteSlug(event.target.value)
                    }}
                  />
                </FormField>
                <FormField label="Production URL" htmlFor="site-production-url">
                  <Input
                    id="site-production-url"
                    data-testid="site-production-url"
                    type="url"
                    required
                    placeholder={DEFAULT_PRODUCTION_URL}
                    value={productionUrl}
                    onChange={(event) => setProductionUrl(event.target.value)}
                  />
                </FormField>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setSiteOpen(false)}
                    disabled={createSiteMutation.isPending}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createSiteMutation.isPending}>
                    {createSiteMutation.isPending ? 'Creating…' : 'Create site'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="members" className="pt-4">
          <OrgMembers organizationId={orgId} />
        </TabsContent>

        <TabsContent value="settings" className="grid gap-6 pt-4">
          <form className="grid max-w-md gap-4" onSubmit={onRename}>
            <div className="grid gap-1">
              <h2 className="text-lg font-medium">General</h2>
              <p className="text-sm text-muted-foreground">
                The slug <span className="font-mono text-xs">{org.slug}</span>{' '}
                cannot be changed.
              </p>
            </div>
            <FormField label="Name" htmlFor="rename-org">
              <Input
                id="rename-org"
                required
                value={orgName}
                onChange={(event) => setOrgName(event.target.value)}
              />
            </FormField>
            <div>
              <Button
                type="submit"
                disabled={renameMutation.isPending || !renameDirty}
              >
                {renameMutation.isPending ? 'Saving…' : 'Save name'}
              </Button>
            </div>
          </form>

          <section className="grid max-w-md gap-3 border-t border-destructive/40 pt-5">
            <div className="grid gap-1">
              <h2 className="text-lg font-medium">Danger zone</h2>
              <p className="text-sm text-muted-foreground">
                Deleting an organization removes its members and invitations.
                This cannot be undone.
              </p>
            </div>
            {hasSites ? (
              <p
                className="text-sm text-muted-foreground"
                data-testid="delete-org-blocked"
              >
                This organization still has {siteCount}{' '}
                {siteCount === 1 ? 'site' : 'sites'}. Delete them from the{' '}
                <button
                  type="button"
                  className="font-medium text-foreground underline underline-offset-4"
                  onClick={() => setTab('sites')}
                >
                  Sites tab
                </button>{' '}
                first.
              </p>
            ) : null}
            <div>
              <ConfirmDialog
                title={`Delete ${org.name}?`}
                description="All members and pending invitations for this organization will be removed. This cannot be undone."
                confirmLabel="Delete organization"
                variant="destructive"
                confirmText={org.slug}
                onConfirm={async () => {
                  await deleteMutation.mutateAsync()
                }}
              >
                <Button
                  type="button"
                  variant="destructive"
                  disabled={hasSites || deleteMutation.isPending}
                >
                  {deleteMutation.isPending
                    ? 'Deleting…'
                    : 'Delete organization'}
                </Button>
              </ConfirmDialog>
            </div>
          </section>
        </TabsContent>
      </Tabs>
    </div>
  )
}
