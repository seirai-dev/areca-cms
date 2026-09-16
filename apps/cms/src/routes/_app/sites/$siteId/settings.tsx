import type { FormEvent } from 'react'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { Layers, Pencil, Plus } from 'lucide-react'
import { toast } from 'sonner'

import type { CollectionDraft } from '#/components/admin/collection-form-dialog'
import { CollectionFormDialog } from '#/components/admin/collection-form-dialog'
import { adminQueryKeys, errorMessage } from '#/components/admin/helpers'
import { TableSkeleton } from '#/components/admin/table-skeleton'
import { TokenAlert } from '#/components/admin/token-alert'
import { ConfirmDialog } from '#/components/confirm-dialog'
import { createDataColumns, DataTable } from '#/components/data-table'
import { EmptyState } from '#/components/empty-state'
import { FormField } from '#/components/form-field'
import { PageHeader } from '#/components/page-header'
import { QueryError } from '#/components/query-error'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { Skeleton } from '#/components/ui/skeleton'
import type { Field } from '#/lib/types'
import { m } from '#/paraglide/messages'
import { listCollectionsFn, upsertCollectionFn } from '#/server/fn/content'
import {
  deleteSiteFn,
  getSiteFn,
  rotateSiteTokenFn,
  updateSiteFn,
} from '#/server/fn/admin'

export const Route = createFileRoute('/_app/sites/$siteId/settings')({
  beforeLoad: ({ context }) => {
    if (!context.me.user.isAgencyAdmin) {
      throw redirect({ to: '/' })
    }
  },
  component: SiteSettingsPage,
})

type CollectionRow = {
  id: string
  key: string
  label: string
  routePattern: string
  enabled: boolean
  fields: Field[]
}

const EMPTY_COLLECTIONS: CollectionRow[] = []

function SiteSettingsPage() {
  const { siteId } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const getSite = useServerFn(getSiteFn)
  const updateSite = useServerFn(updateSiteFn)
  const rotateSiteToken = useServerFn(rotateSiteTokenFn)
  const deleteSite = useServerFn(deleteSiteFn)
  const listCollections = useServerFn(listCollectionsFn)
  const upsertCollection = useServerFn(upsertCollectionFn)

  const siteQuery = useQuery({
    queryKey: adminQueryKeys.site(siteId),
    queryFn: () => getSite({ data: { id: siteId } }),
  })
  const collectionsQuery = useQuery({
    queryKey: adminQueryKeys.collections(siteId),
    queryFn: () => listCollections({ data: { siteId } }),
  })

  const site = siteQuery.data
  const [name, setName] = useState<string | null>(null)
  const [productionUrl, setProductionUrl] = useState<string | null>(null)
  const [applicationId, setApplicationId] = useState<string | null>(null)
  const [healthCheckUrl, setHealthCheckUrl] = useState<string | null>(null)
  const [rotatedToken, setRotatedToken] = useState<string | null>(null)
  const [collectionOpen, setCollectionOpen] = useState(false)
  const [editingCollection, setEditingCollection] =
    useState<CollectionDraft | null>(null)
  const [clearTargetOpen, setClearTargetOpen] = useState(false)

  const displayName = name ?? site?.name ?? ''
  const displayUrl = productionUrl ?? site?.productionUrl ?? ''
  const displayAppId =
    applicationId ?? site?.deploymentTarget?.applicationId ?? ''
  const displayHealth =
    healthCheckUrl ?? site?.deploymentTarget?.healthCheckUrl ?? ''

  const generalMutation = useMutation({
    mutationFn: () =>
      updateSite({
        data: { id: siteId, name: displayName, productionUrl: displayUrl },
      }),
    onSuccess: async () => {
      toast.success(m.sites_updated())
      setName(null)
      setProductionUrl(null)
      await queryClient.invalidateQueries({
        queryKey: adminQueryKeys.site(siteId),
      })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const targetMutation = useMutation({
    mutationFn: (
      deploymentTarget: {
        provider: 'dokploy'
        applicationId: string
        healthCheckUrl?: string
      } | null,
    ) => updateSite({ data: { id: siteId, deploymentTarget } }),
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

  const collectionMutation = useMutation({
    mutationFn: (draft: CollectionDraft) =>
      upsertCollection({
        data: {
          siteId,
          key: draft.key,
          label: draft.label,
          routePattern: draft.routePattern,
          enabled: draft.enabled,
          fields: draft.fields,
        },
      }),
    onSuccess: async () => {
      toast.success(m.sites_collection_saved())
      setCollectionOpen(false)
      setEditingCollection(null)
      await queryClient.invalidateQueries({
        queryKey: adminQueryKeys.collections(siteId),
      })
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

  function onGeneral(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    generalMutation.mutate()
  }

  function onTarget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    targetMutation.mutate({
      provider: 'dokploy',
      applicationId: displayAppId.trim(),
      healthCheckUrl: displayHealth.trim() || undefined,
    })
  }

  function openCollectionDialog(draft: CollectionDraft | null) {
    setEditingCollection(draft)
    requestAnimationFrame(() => setCollectionOpen(true))
  }

  const collectionHelper = createDataColumns<CollectionRow>()
  const collectionColumns = collectionHelper.columns([
    collectionHelper.accessor('key', {
      header: m.sites_column_key(),
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.key}</span>
      ),
    }),
    collectionHelper.accessor('label', { header: m.sites_column_label() }),
    collectionHelper.accessor('routePattern', {
      header: m.sites_column_route(),
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.routePattern}</span>
      ),
    }),
    collectionHelper.accessor('enabled', {
      header: m.sites_column_enabled(),
      cell: ({ row }) => (
        <Badge variant={row.original.enabled ? 'default' : 'secondary'}>
          {row.original.enabled ? m.sites_yes() : m.sites_no()}
        </Badge>
      ),
    }),
    collectionHelper.accessor((row) => row.fields.length, {
      id: 'fields',
      header: m.sites_column_fields(),
    }),
    collectionHelper.display({
      id: 'actions',
      header: () => <span className="sr-only">{m.sites_actions()}</span>,
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              openCollectionDialog({
                key: row.original.key,
                label: row.original.label,
                routePattern: row.original.routePattern,
                enabled: row.original.enabled,
                fields: row.original.fields,
              })
            }
          >
            <Pencil />
            {m.sites_edit()}
          </Button>
        </div>
      ),
    }),
  ])

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

  const manifestKeys = site.lastManifest
    ? Object.keys(site.lastManifest.collections)
    : []
  const collections: CollectionRow[] =
    collectionsQuery.data ?? EMPTY_COLLECTIONS

  return (
    <div className="grid max-w-3xl gap-6">
      <PageHeader
        title={m.sites_settings_title()}
        description={m.sites_settings_description({ name: site.name })}
      />

      <Card>
        <CardHeader>
          <CardTitle>{m.sites_general()}</CardTitle>
          <CardDescription>
            {m.sites_general_description_before()}{' '}
            <code>http://localhost:3001</code>
            {m.sites_general_description_mid()} <code>/__preview/…</code>{' '}
            {m.sites_general_description_after()}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={onGeneral}>
            <FormField label={m.sites_name()} htmlFor="settings-site-name">
              <Input
                id="settings-site-name"
                required
                value={displayName}
                onChange={(event) => setName(event.target.value)}
              />
            </FormField>
            <FormField
              label={m.sites_production_url()}
              htmlFor="settings-production-url"
            >
              <Input
                id="settings-production-url"
                type="url"
                required
                placeholder={m.sites_url_placeholder()}
                value={displayUrl}
                onChange={(event) => setProductionUrl(event.target.value)}
              />
            </FormField>
            <div>
              <Button type="submit" disabled={generalMutation.isPending}>
                {generalMutation.isPending
                  ? m.sites_saving()
                  : m.sites_save_changes()}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{m.sites_deployment_target()}</CardTitle>
          <CardDescription>
            {m.sites_deployment_target_description()}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={onTarget}>
            <FormField label={m.sites_provider()} htmlFor="deployment-provider">
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
                type="submit"
                data-testid="save-deployment-target"
                disabled={targetMutation.isPending}
              >
                {targetMutation.isPending
                  ? m.sites_saving()
                  : m.sites_save_target()}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={targetMutation.isPending || !site.deploymentTarget}
                onClick={() => setClearTargetOpen(true)}
              >
                {m.sites_clear_target()}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{m.sites_token()}</CardTitle>
          <CardDescription>
            {m.sites_token_description_before()} <code>ARECA_SITE_TOKEN</code>{' '}
            {m.sites_token_description_and()} <code>ARECA_CMS_URL</code>
            {m.sites_token_description_after()}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="grid gap-1.5">
            <CardTitle>{m.sites_collections()}</CardTitle>
            <CardDescription>
              {site.lastManifest
                ? manifestKeys.length === 0
                  ? m.sites_manifest_synced_empty({
                      count: manifestKeys.length,
                    })
                  : manifestKeys.length === 1
                    ? m.sites_manifest_synced_one({
                        count: manifestKeys.length,
                        keys: manifestKeys.join(', '),
                      })
                    : m.sites_manifest_synced_other({
                        count: manifestKeys.length,
                        keys: manifestKeys.join(', '),
                      })
                : m.sites_manifest_none()}
            </CardDescription>
          </div>
          <Button
            type="button"
            data-testid="add-collection"
            onClick={() => openCollectionDialog(null)}
          >
            <Plus />
            {m.sites_add_collection()}
          </Button>
        </CardHeader>
        <CardContent>
          {collectionsQuery.isError ? (
            <QueryError
              title={m.sites_collections_load_error()}
              error={collectionsQuery.error}
              onRetry={() => collectionsQuery.refetch()}
              retrying={collectionsQuery.isFetching}
            />
          ) : collectionsQuery.isLoading ? (
            <TableSkeleton />
          ) : collections.length ? (
            <DataTable
              columns={collectionColumns}
              data={collections}
              caption={m.sites_collections()}
            />
          ) : (
            <EmptyState
              icon={<Layers />}
              title={m.sites_no_collections()}
              description={m.sites_no_collections_description()}
            />
          )}
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle>{m.sites_danger_zone()}</CardTitle>
          <CardDescription>{m.sites_danger_zone_description()}</CardDescription>
        </CardHeader>
        <CardContent>
          <ConfirmDialog
            title={m.sites_delete_site_title()}
            description={m.sites_delete_site_description({ name: site.name })}
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
        </CardContent>
      </Card>

      <CollectionFormDialog
        open={collectionOpen}
        onOpenChange={setCollectionOpen}
        initial={editingCollection}
        pending={collectionMutation.isPending}
        onSubmit={(draft) => collectionMutation.mutate(draft)}
      />

      <ConfirmDialog
        open={clearTargetOpen}
        onOpenChange={setClearTargetOpen}
        title={m.sites_clear_target_title()}
        description={m.sites_clear_target_description()}
        confirmLabel={m.sites_clear_target()}
        variant="destructive"
        onConfirm={async () => {
          await targetMutation.mutateAsync(null)
        }}
      />
    </div>
  )
}
