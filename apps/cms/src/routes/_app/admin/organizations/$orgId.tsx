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
import { CheckCircle2, Globe, Plus } from 'lucide-react'
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
import { Badge } from '#/components/ui/badge'
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
import { m } from '#/paraglide/messages'
import {
  createSiteFn,
  deleteOrganizationFn,
  getDokployCredentialStatusFn,
  listOrganizationsFn,
  listSitesFn,
  removeDokployCredentialsFn,
  saveDokployCredentialsFn,
  updateOrganizationFn,
  verifyDokployCredentialsFn,
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
    header: () => m.admin_name(),
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  }),
  siteHelper.accessor('slug', {
    header: () => m.admin_slug(),
    cell: ({ row }) => (
      <span className="font-mono text-xs text-muted-foreground">
        {row.original.slug}
      </span>
    ),
  }),
  siteHelper.accessor('productionUrl', {
    header: () => m.admin_org_col_production_url(),
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
    header: () => <span className="sr-only">{m.admin_actions()}</span>,
    enableSorting: false,
    cell: ({ row }) => (
      <div className="flex justify-end">
        <Link
          to="/sites/$siteId/settings"
          params={{ siteId: row.original.id }}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          {m.admin_settings()}
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
  const getDokployCredentialStatus = useServerFn(getDokployCredentialStatusFn)
  const saveDokployCredentials = useServerFn(saveDokployCredentialsFn)
  const verifyDokployCredentials = useServerFn(verifyDokployCredentialsFn)
  const removeDokployCredentials = useServerFn(removeDokployCredentialsFn)

  const [tab, setTab] = useState<OrgTab>('sites')
  const [siteOpen, setSiteOpen] = useState(false)
  const [siteName, setSiteName] = useState('')
  const [siteSlug, setSiteSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [productionUrl, setProductionUrl] = useState(DEFAULT_PRODUCTION_URL)
  const [createdToken, setCreatedToken] = useState<string | null>(null)
  const [orgName, setOrgName] = useState('')
  const [dokployUrl, setDokployUrl] = useState('')
  const [dokployApiKey, setDokployApiKey] = useState('')
  const [dokployApplications, setDokployApplications] = useState<
    Awaited<ReturnType<typeof verifyDokployCredentialsFn>> | undefined
  >()

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
  const dokployQuery = useQuery({
    queryKey: adminQueryKeys.dokployCredentials(orgId),
    queryFn: () =>
      getDokployCredentialStatus({ data: { organizationId: orgId } }),
  })

  const org = orgsQuery.data?.find((item) => item.id === orgId)

  // Seed the rename field once the org is known (and whenever it changes
  // after a successful save).
  useEffect(() => {
    if (org) {
      setOrgName(org.name)
    }
  }, [org])

  useEffect(() => {
    if (dokployQuery.data) {
      setDokployUrl(dokployQuery.data.url ?? '')
      setDokployApiKey('')
    }
  }, [dokployQuery.data])

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
      toast.success(m.admin_org_toast_site_created())
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
      toast.success(m.admin_org_toast_renamed())
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
      toast.success(m.admin_org_toast_deleted())
      await queryClient.invalidateQueries({
        queryKey: adminQueryKeys.organizations,
      })
      await navigate({ to: '/admin/organizations' })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const saveDokployMutation = useMutation({
    mutationFn: () =>
      saveDokployCredentials({
        data: {
          organizationId: orgId,
          url: dokployUrl.trim(),
          apiKey: dokployApiKey.trim() || undefined,
        },
      }),
    onSuccess: async (result) => {
      toast.success(m.admin_org_dokploy_saved())
      setDokployUrl(result.url)
      setDokployApiKey('')
      setDokployApplications({
        applications: result.applications,
        total: result.total,
      })
      await queryClient.invalidateQueries({
        queryKey: adminQueryKeys.dokployCredentials(orgId),
      })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const verifyDokployMutation = useMutation({
    mutationFn: () =>
      verifyDokployCredentials({ data: { organizationId: orgId } }),
    onSuccess: (result) => {
      toast.success(m.admin_org_dokploy_verified())
      setDokployApplications(result)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const removeDokployMutation = useMutation({
    mutationFn: () =>
      removeDokployCredentials({ data: { organizationId: orgId } }),
    onSuccess: async () => {
      toast.success(m.admin_org_dokploy_removed())
      setDokployUrl('')
      setDokployApiKey('')
      setDokployApplications(undefined)
      await queryClient.invalidateQueries({
        queryKey: adminQueryKeys.dokployCredentials(orgId),
      })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  if (orgsQuery.isError) {
    return (
      <div className="grid gap-6">
        <QueryError
          title={m.admin_org_load_error()}
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
        title={m.admin_org_not_found_title()}
        description={m.admin_org_not_found_description()}
        action={
          <Link
            to="/admin/organizations"
            className={buttonVariants({ variant: 'outline' })}
          >
            {m.admin_org_back()}
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

  function onSaveDokploy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    saveDokployMutation.mutate()
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
          <TabsTrigger value="sites">{m.admin_sites()}</TabsTrigger>
          <TabsTrigger value="members">{m.admin_members()}</TabsTrigger>
          <TabsTrigger value="settings">{m.admin_settings()}</TabsTrigger>
        </TabsList>

        <TabsContent value="sites" className="grid gap-4 pt-4">
          <Dialog open={siteOpen} onOpenChange={setSiteOpen}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-medium">{m.admin_sites()}</h2>
              <DialogTrigger asChild>
                <Button type="button" data-testid="new-site">
                  <Plus />
                  {m.admin_org_new_site()}
                </Button>
              </DialogTrigger>
            </div>
            {sitesQuery.isError ? (
              <QueryError
                title={m.admin_org_sites_load_error()}
                error={sitesQuery.error}
                onRetry={() => void sitesQuery.refetch()}
                retrying={sitesQuery.isFetching}
              />
            ) : sitesQuery.isPending ? (
              <TableSkeleton columns={4} />
            ) : sitesQuery.data.length === 0 ? (
              <EmptyState
                icon={<Globe />}
                title={m.admin_org_sites_empty_title()}
                description={m.admin_org_sites_empty_description()}
                action={
                  siteOpen ? undefined : (
                    <Button type="button" onClick={() => setSiteOpen(true)}>
                      <Plus />
                      {m.admin_org_new_site()}
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
                caption={m.admin_org_sites_caption({ name: org.name })}
              />
            )}
            <DialogContent>
              <form className="grid gap-4" onSubmit={onCreateSite}>
                <DialogHeader>
                  <DialogTitle>{m.admin_org_new_site_title()}</DialogTitle>
                  <DialogDescription>
                    {m.admin_org_new_site_description({
                      url: DEFAULT_PRODUCTION_URL,
                    })}
                  </DialogDescription>
                </DialogHeader>
                <FormField label={m.admin_name()} htmlFor="site-name">
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
                <FormField label={m.admin_slug()} htmlFor="site-slug">
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
                <FormField
                  label={m.admin_org_production_url()}
                  htmlFor="site-production-url"
                >
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
                    {m.admin_cancel()}
                  </Button>
                  <Button type="submit" disabled={createSiteMutation.isPending}>
                    {createSiteMutation.isPending
                      ? m.admin_creating()
                      : m.admin_org_create_site()}
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
              <h2 className="text-lg font-medium">{m.admin_org_general()}</h2>
              <p className="text-sm text-muted-foreground">
                {m.admin_org_slug_immutable_before()}
                <span className="font-mono text-xs">{org.slug}</span>
                {m.admin_org_slug_immutable_after()}
              </p>
            </div>
            <FormField label={m.admin_name()} htmlFor="rename-org">
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
                {renameMutation.isPending
                  ? m.admin_saving()
                  : m.admin_org_save_name()}
              </Button>
            </div>
          </form>

          <section className="grid max-w-2xl gap-4 border-t pt-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid gap-1">
                <h2 className="text-lg font-medium">
                  {m.admin_org_dokploy_title()}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {m.admin_org_dokploy_description()}
                </p>
              </div>
              <Badge
                variant={
                  dokployQuery.data?.configured ? 'default' : 'secondary'
                }
              >
                {dokployQuery.data?.configured
                  ? m.admin_org_dokploy_configured()
                  : m.admin_org_dokploy_not_configured()}
              </Badge>
            </div>

            {dokployQuery.isError ? (
              <QueryError
                title={m.admin_org_dokploy_load_error()}
                error={dokployQuery.error}
                onRetry={() => void dokployQuery.refetch()}
                retrying={dokployQuery.isFetching}
              />
            ) : (
              <form className="grid gap-4" onSubmit={onSaveDokploy}>
                <FormField
                  label={m.admin_org_dokploy_url()}
                  htmlFor="dokploy-url"
                >
                  <Input
                    id="dokploy-url"
                    data-testid="dokploy-url"
                    type="url"
                    required
                    placeholder="https://dokploy.example.com"
                    value={dokployUrl}
                    onChange={(event) => setDokployUrl(event.target.value)}
                  />
                </FormField>
                <FormField
                  label={m.admin_org_dokploy_api_key()}
                  htmlFor="dokploy-api-key"
                  description={
                    dokployQuery.data?.configured
                      ? m.admin_org_dokploy_api_key_replace_hint()
                      : m.admin_org_dokploy_api_key_new_hint()
                  }
                >
                  <Input
                    id="dokploy-api-key"
                    data-testid="dokploy-api-key"
                    type="password"
                    required={!dokployQuery.data?.configured}
                    autoComplete="new-password"
                    value={dokployApiKey}
                    onChange={(event) => setDokployApiKey(event.target.value)}
                  />
                </FormField>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="submit"
                    data-testid="save-dokploy-credentials"
                    disabled={
                      saveDokployMutation.isPending || dokployQuery.isPending
                    }
                  >
                    {saveDokployMutation.isPending
                      ? m.admin_saving()
                      : m.admin_org_dokploy_save()}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    data-testid="verify-dokploy-credentials"
                    disabled={
                      !dokployQuery.data?.configured ||
                      verifyDokployMutation.isPending ||
                      saveDokployMutation.isPending
                    }
                    onClick={() => verifyDokployMutation.mutate()}
                  >
                    <CheckCircle2 />
                    {verifyDokployMutation.isPending
                      ? m.admin_org_dokploy_verifying()
                      : m.admin_org_dokploy_verify()}
                  </Button>
                  {dokployQuery.data?.configured ? (
                    <ConfirmDialog
                      title={m.admin_org_dokploy_remove_title()}
                      description={m.admin_org_dokploy_remove_description()}
                      confirmLabel={m.admin_org_dokploy_remove()}
                      variant="destructive"
                      onConfirm={async () => {
                        await removeDokployMutation.mutateAsync()
                      }}
                    >
                      <Button
                        type="button"
                        variant="outline"
                        data-testid="remove-dokploy-credentials"
                        disabled={removeDokployMutation.isPending}
                      >
                        {m.admin_org_dokploy_remove()}
                      </Button>
                    </ConfirmDialog>
                  ) : null}
                </div>
              </form>
            )}

            {dokployApplications ? (
              <div className="grid gap-2" data-testid="dokploy-applications">
                <h3 className="font-medium">
                  {m.admin_org_dokploy_applications({
                    count: dokployApplications.total,
                  })}
                </h3>
                {dokployApplications.applications.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {m.admin_org_dokploy_no_applications()}
                  </p>
                ) : (
                  <ul className="divide-y rounded-md border">
                    {dokployApplications.applications.map((application) => (
                      <li
                        key={application.applicationId}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                      >
                        <div>
                          <p className="font-medium">{application.name}</p>
                          <code className="text-xs text-muted-foreground">
                            {application.applicationId}
                          </code>
                        </div>
                        {application.applicationStatus ? (
                          <Badge variant="outline">
                            {application.applicationStatus}
                          </Badge>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
                {dokployApplications.total >
                dokployApplications.applications.length ? (
                  <p className="text-xs text-muted-foreground">
                    {m.admin_org_dokploy_applications_truncated({
                      shown: dokployApplications.applications.length,
                      total: dokployApplications.total,
                    })}
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="grid max-w-md gap-3 border-t border-destructive/40 pt-5">
            <div className="grid gap-1">
              <h2 className="text-lg font-medium">
                {m.admin_org_danger_zone()}
              </h2>
              <p className="text-sm text-muted-foreground">
                {m.admin_org_danger_description()}
              </p>
            </div>
            {hasSites ? (
              <p
                className="text-sm text-muted-foreground"
                data-testid="delete-org-blocked"
              >
                {siteCount === 1
                  ? m.admin_org_delete_blocked_one_before()
                  : m.admin_org_delete_blocked_many_before({
                      count: siteCount,
                    })}
                <button
                  type="button"
                  className="font-medium text-foreground underline underline-offset-4"
                  onClick={() => setTab('sites')}
                >
                  {m.admin_org_sites_tab()}
                </button>
                {m.admin_org_delete_blocked_after()}
              </p>
            ) : null}
            <div>
              <ConfirmDialog
                title={m.admin_org_delete_title({ name: org.name })}
                description={m.admin_org_delete_description()}
                confirmLabel={m.admin_org_delete_label()}
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
                    ? m.admin_deleting()
                    : m.admin_org_delete_label()}
                </Button>
              </ConfirmDialog>
            </div>
          </section>
        </TabsContent>
      </Tabs>
    </div>
  )
}
