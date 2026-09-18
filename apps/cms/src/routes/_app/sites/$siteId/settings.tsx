import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { toast } from 'sonner'

import { adminQueryKeys, errorMessage } from '#/components/admin/helpers'
import { TableSkeleton } from '#/components/admin/table-skeleton'
import { TokenAlert } from '#/components/admin/token-alert'
import { ConfirmDialog } from '#/components/confirm-dialog'
import { EmptyState } from '#/components/empty-state'
import { FormField } from '#/components/form-field'
import { PageHeader } from '#/components/page-header'
import { QueryError } from '#/components/query-error'
import { Button } from '#/components/ui/button'
import { PageSection, SectionedPage } from '#/components/section-nav'
import { SaveBar } from '#/components/save-bar'
import { Input } from '#/components/ui/input'
import { Skeleton } from '#/components/ui/skeleton'
import { m } from '#/paraglide/messages'
import {
  deleteSiteFn,
  getSiteFn,
  rotateSiteTokenFn,
  updateSiteFn,
} from '#/server/fn/admin'
import { Check, Copy } from '@phosphor-icons/react'

export const Route = createFileRoute('/_app/sites/$siteId/settings')({
  beforeLoad: ({ context }) => {
    if (!context.me.user.isAgencyAdmin) {
      throw redirect({ to: '/' })
    }
  },
  component: SiteSettingsPage,
})

function SiteSettingsPage() {
  const { siteId } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const getSite = useServerFn(getSiteFn)
  const updateSite = useServerFn(updateSiteFn)
  const rotateSiteToken = useServerFn(rotateSiteTokenFn)
  const deleteSite = useServerFn(deleteSiteFn)

  const siteQuery = useQuery({
    queryKey: adminQueryKeys.site(siteId),
    queryFn: () => getSite({ data: { id: siteId } }),
  })

  const site = siteQuery.data
  const [name, setName] = useState<string | null>(null)
  const [productionUrl, setProductionUrl] = useState<string | null>(null)
  const [applicationId, setApplicationId] = useState<string | null>(null)
  const [healthCheckUrl, setHealthCheckUrl] = useState<string | null>(null)
  const [rotatedToken, setRotatedToken] = useState<string | null>(null)
  const [clearTargetOpen, setClearTargetOpen] = useState(false)

  const displayName = name ?? site?.name ?? ''
  const displayUrl = productionUrl ?? site?.productionUrl ?? ''
  const displayAppId =
    applicationId ?? site?.deploymentTarget?.applicationId ?? ''
  const displayHealth =
    healthCheckUrl ?? site?.deploymentTarget?.healthCheckUrl ?? ''

  // General and Deployment target share one save bar, so they share one
  // request: `updateSiteFn` accepts both halves at once.
  const saveMutation = useMutation({
    mutationFn: () =>
      updateSite({
        data: {
          id: siteId,
          name: displayName,
          productionUrl: displayUrl,
          ...(displayAppId.trim()
            ? {
                deploymentTarget: {
                  provider: 'dokploy' as const,
                  applicationId: displayAppId.trim(),
                  healthCheckUrl: displayHealth.trim() || undefined,
                },
              }
            : {}),
        },
      }),
    onSuccess: async () => {
      toast.success(m.sites_updated())
      setName(null)
      setProductionUrl(null)
      setApplicationId(null)
      setHealthCheckUrl(null)
      await queryClient.invalidateQueries({
        queryKey: adminQueryKeys.site(siteId),
      })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const clearTargetMutation = useMutation({
    mutationFn: () =>
      updateSite({ data: { id: siteId, deploymentTarget: null } }),
    onSuccess: async () => {
      toast.success(m.sites_deployment_target_updated())
      setApplicationId(null)
      setHealthCheckUrl(null)
      await queryClient.invalidateQueries({
        queryKey: adminQueryKeys.site(siteId),
      })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const rotateMutation = useMutation({
    mutationFn: () => rotateSiteToken({ data: { id: siteId } }),
    onSuccess: (result) => {
      toast.success(m.sites_token_rotated())
      setRotatedToken(result.token)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteSite({ data: { id: siteId } }),
    onSuccess: async () => {
      toast.success(m.sites_deleted())
      await navigate({ to: '/' })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const dirty =
    name !== null ||
    productionUrl !== null ||
    applicationId !== null ||
    healthCheckUrl !== null

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    saveMutation.mutate()
  }

  if (siteQuery.isLoading) {
    return (
      <div className="grid max-w-3xl gap-6">
        <Skeleton className="h-10 w-64" />
        <TableSkeleton />
      </div>
    )
  }

  if (siteQuery.isError) {
    return (
      <div className="max-w-3xl">
        <QueryError
          title={m.sites_load_error()}
          error={siteQuery.error}
          onRetry={() => siteQuery.refetch()}
          retrying={siteQuery.isFetching}
        />
      </div>
    )
  }

  if (!site) {
    return (
      <EmptyState
        className="max-w-3xl"
        title={m.sites_not_found_title()}
        description={m.sites_settings_not_found_description()}
        action={
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate({ to: '/' })}
          >
            {m.sites_back_to_dashboard()}
          </Button>
        }
      />
    )
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        size="sm"
        title={m.sites_settings_title()}
        description={m.sites_settings_description({ name: site.name })}
      />

      <SectionedPage
        links={[
          { id: 'general', label: m.sites_general() },
          { id: 'deployment', label: m.sites_deployment_target() },
          { id: 'token', label: m.sites_token() },
          { id: 'danger', label: m.sites_danger_zone(), danger: true },
        ]}
      >
        <form className="grid gap-10" onSubmit={onSubmit}>
          <PageSection
            id="general"
            title={m.sites_general()}
            description={
              <>
                {m.sites_general_description_before()}{' '}
                <code>http://localhost:3001</code>
                {m.sites_general_description_mid()} <code>/__preview/…</code>{' '}
                {m.sites_general_description_after()}
              </>
            }
          >
            <div className="grid gap-4">
              <FormField label={m.sites_name()} htmlFor="settings-site-name">
                <Input
                  id="settings-site-name"
                  required
                  value={displayName}
                  onChange={(event) => setName(event.target.value)}
                />
              </FormField>
              <FormField
                label={m.sites_slug()}
                htmlFor="settings-site-slug"
                hint={
                  <>
                    {m.sites_slug_hint_before()}{' '}
                    <code className="font-mono">--site-key</code>{' '}
                    {m.sites_slug_hint_after()}
                  </>
                }
              >
                <CopyableSlug slug={site.slug} />
              </FormField>
              <FormField
                label={m.sites_production_url()}
                htmlFor="settings-production-url"
              >
                <Input
                  id="settings-production-url"
                  data-testid="site-production-url"
                  type="url"
                  required
                  placeholder={m.sites_url_placeholder()}
                  value={displayUrl}
                  onChange={(event) => setProductionUrl(event.target.value)}
                />
              </FormField>
            </div>
          </PageSection>

          <PageSection
            id="deployment"
            title={m.sites_deployment_target()}
            description={<>{m.sites_deployment_target_description()}</>}
          >
            <div className="grid gap-4">
              <FormField
                label={m.sites_provider()}
                htmlFor="deployment-provider"
              >
                <Input id="deployment-provider" value="Dokploy" readOnly />
              </FormField>
              <FormField
                label={m.sites_application_id()}
                htmlFor="application-id"
              >
                <Input
                  id="application-id"
                  data-testid="application-id"
                  required
                  value={displayAppId}
                  onChange={(event) => setApplicationId(event.target.value)}
                />
              </FormField>
              <FormField
                label={m.sites_health_check_url()}
                htmlFor="health-check-url"
              >
                <Input
                  id="health-check-url"
                  data-testid="health-check-url"
                  type="url"
                  placeholder={m.sites_health_check_placeholder()}
                  value={displayHealth}
                  onChange={(event) => setHealthCheckUrl(event.target.value)}
                />
              </FormField>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    clearTargetMutation.isPending || !site.deploymentTarget
                  }
                  onClick={() => setClearTargetOpen(true)}
                >
                  {m.sites_clear_target()}
                </Button>
              </div>
            </div>
          </PageSection>

          <PageSection
            id="token"
            title={m.sites_token()}
            description={
              <>
                {m.sites_token_description_before()}{' '}
                <code>ARECA_SITE_TOKEN</code> {m.sites_token_description_and()}{' '}
                <code>ARECA_CMS_URL</code>
                {m.sites_token_description_after()}
              </>
            }
          >
            <div className="grid gap-4">
              {rotatedToken ? <TokenAlert token={rotatedToken} /> : null}
              <div>
                <ConfirmDialog
                  title={m.sites_rotate_token_title()}
                  description={m.sites_rotate_token_description()}
                  confirmLabel={m.sites_rotate_token()}
                  variant="destructive"
                  onConfirm={async () => {
                    await rotateMutation.mutateAsync()
                  }}
                >
                  <Button
                    type="button"
                    variant="outline"
                    disabled={rotateMutation.isPending}
                  >
                    {rotateMutation.isPending
                      ? m.sites_rotating()
                      : m.sites_rotate_token()}
                  </Button>
                </ConfirmDialog>
              </div>
            </div>
          </PageSection>

          <PageSection
            id="danger"
            title={m.sites_danger_zone()}
            description={m.sites_danger_zone_description()}
            danger
          >
            <div>
              <ConfirmDialog
                title={m.sites_delete_site_title()}
                description={m.sites_delete_site_description({
                  name: site.name,
                })}
                confirmLabel={m.sites_delete_site()}
                confirmText={site.slug}
                variant="destructive"
                onConfirm={async () => {
                  await deleteMutation.mutateAsync()
                }}
              >
                <Button
                  type="button"
                  variant="destructive"
                  disabled={deleteMutation.isPending}
                >
                  {deleteMutation.isPending
                    ? m.sites_deleting()
                    : m.sites_delete_site()}
                </Button>
              </ConfirmDialog>
            </div>
          </PageSection>

          <SaveBar
            dirty={dirty}
            saving={saveMutation.isPending}
            testId="save-deployment-target"
          />
        </form>
      </SectionedPage>

      <ConfirmDialog
        open={clearTargetOpen}
        onOpenChange={setClearTargetOpen}
        title={m.sites_clear_target_title()}
        description={m.sites_clear_target_description()}
        confirmLabel={m.sites_clear_target()}
        variant="destructive"
        onConfirm={async () => {
          await clearTargetMutation.mutateAsync()
        }}
      />
    </div>
  )
}

function CopyableSlug({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) {
      return
    }
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])

  async function copy() {
    try {
      await navigator.clipboard.writeText(slug)
      setCopied(true)
      toast.success(m.sites_slug_copied())
    } catch {
      toast.error(m.sites_slug_copy_error())
    }
  }

  return (
    <div className="flex gap-2">
      <Input
        id="settings-site-slug"
        data-testid="settings-site-slug"
        readOnly
        className="font-mono"
        value={slug}
        onFocus={(event) => event.currentTarget.select()}
      />
      <Button
        type="button"
        variant="outline"
        onClick={() => void copy()}
        aria-label={m.sites_slug_copy_aria()}
      >
        {copied ? <Check /> : <Copy />}
        {copied ? m.sites_slug_copied_label() : m.sites_slug_copy()}
      </Button>
    </div>
  )
}
