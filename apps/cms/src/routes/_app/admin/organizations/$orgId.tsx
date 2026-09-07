import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Link,
  createFileRoute,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
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
import { EmptyState } from '#/components/empty-state'
import { FormField } from '#/components/form-field'
import { PageHeader } from '#/components/page-header'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
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

  const [siteOpen, setSiteOpen] = useState(false)
  const [siteName, setSiteName] = useState('')
  const [siteSlug, setSiteSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [productionUrl, setProductionUrl] = useState('http://localhost:3001')
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
      setProductionUrl('http://localhost:3001')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminQueryKeys.sites(orgId) }),
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
      updateOrganization({ data: { id: orgId, name: orgName } }),
    onSuccess: async () => {
      toast.success('Organization updated')
      await queryClient.invalidateQueries({
        queryKey: adminQueryKeys.organizations,
      })
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

  if (orgsQuery.isLoading) {
    return <TableSkeleton />
  }

  if (!org) {
    return (
      <EmptyState
        title="Organization not found"
        description="It may have been deleted."
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

  const hasSites = (org.siteCount ?? 0) > 0 || (sitesQuery.data?.length ?? 0) > 0

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

      <Tabs defaultValue="sites">
        <TabsList>
          <TabsTrigger value="sites">Sites</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="sites" className="grid gap-4 pt-4">
          <Dialog open={siteOpen} onOpenChange={setSiteOpen}>
            <div className="flex justify-end">
              <DialogTrigger asChild>
                <Button type="button" data-testid="new-site">
                  New site
                </Button>
              </DialogTrigger>
            </div>
            {sitesQuery.isLoading ? (
              <TableSkeleton />
            ) : sitesQuery.data?.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Slug</TableHead>
                    <TableHead>Production URL</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sitesQuery.data.map((site) => (
                    <TableRow key={site.id}>
                      <TableCell>{site.name}</TableCell>
                      <TableCell>{site.slug}</TableCell>
                      <TableCell>{site.productionUrl}</TableCell>
                      <TableCell>
                        <Link
                          to="/sites/$siteId/settings"
                          params={{ siteId: site.id }}
                          className="text-sm hover:underline"
                        >
                          Settings
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState
                title="No sites"
                description="Create a site to get a site token for the SDK."
                action={
                  siteOpen ? undefined : (
                    <Button type="button" onClick={() => setSiteOpen(true)}>
                      New site
                    </Button>
                  )
                }
              />
            )}
            <DialogContent>
              <form className="grid gap-4" onSubmit={onCreateSite}>
                <DialogHeader>
                  <DialogTitle>New site</DialogTitle>
                  <DialogDescription>
                    The site token is shown once after creation. For the local
                    demo site use http://localhost:3001 as the production URL.
                  </DialogDescription>
                </DialogHeader>
                <FormField label="Name" htmlFor="site-name">
                  <Input
                    id="site-name"
                    data-testid="site-name"
                    required
                    value={siteName}
                    onChange={(event) => onSiteNameChange(event.target.value)}
                  />
                </FormField>
                <FormField label="Slug" htmlFor="site-slug">
                  <Input
                    id="site-slug"
                    data-testid="site-slug"
                    required
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
                    placeholder="http://localhost:3001"
                    value={productionUrl}
                    onChange={(event) => setProductionUrl(event.target.value)}
                  />
                </FormField>
                <DialogFooter>
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

        <TabsContent value="settings" className="grid gap-8 pt-4">
          <form className="grid max-w-md gap-4" onSubmit={onRename}>
            <h2 className="text-lg font-medium">Rename</h2>
            <FormField label="Name" htmlFor="rename-org">
              <Input
                id="rename-org"
                required
                defaultValue={org.name}
                onChange={(event) => setOrgName(event.target.value)}
              />
            </FormField>
            <Button type="submit" disabled={renameMutation.isPending || !orgName}>
              {renameMutation.isPending ? 'Saving…' : 'Save name'}
            </Button>
          </form>
          <div className="grid max-w-md gap-3 rounded-lg border border-destructive/40 p-4">
            <h2 className="text-lg font-medium">Danger zone</h2>
            <p className="text-sm text-muted-foreground">
              Organizations that still have sites cannot be deleted.
            </p>
            <ConfirmDialog
              title="Delete organization"
              description="This cannot be undone."
              confirmLabel="Delete"
              onConfirm={async () => {
                await deleteMutation.mutateAsync()
              }}
            >
              <Button type="button" variant="destructive" disabled={hasSites}>
                Delete organization
              </Button>
            </ConfirmDialog>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
