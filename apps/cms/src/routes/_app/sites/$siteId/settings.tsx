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
      toast.success('Site updated')
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
      toast.success('Deployment target updated')
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
      toast.success('Site token rotated')
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
      toast.success('Collection saved')
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
      toast.success('Site deleted')
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
      header: 'Key',
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.key}</span>
      ),
    }),
    collectionHelper.accessor('label', { header: 'Label' }),
    collectionHelper.accessor('routePattern', {
      header: 'Route',
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.routePattern}</span>
      ),
    }),
    collectionHelper.accessor('enabled', {
      header: 'Enabled',
      cell: ({ row }) => (
        <Badge variant={row.original.enabled ? 'default' : 'secondary'}>
          {row.original.enabled ? 'Yes' : 'No'}
        </Badge>
      ),
    }),
    collectionHelper.accessor((row) => row.fields.length, {
      id: 'fields',
      header: 'Fields',
    }),
    collectionHelper.display({
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
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
            Edit
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
          title="Could not load site"
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
        title="Site not found"
        description="This site may have been deleted or you no longer have access to it."
        action={
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate({ to: '/' })}
          >
            Back to dashboard
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
        title="Site settings"
        description={`Configuration for ${site.name}.`}
      />

      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>
            Production URL is the live site origin (local demo:{' '}
            <code>http://localhost:3001</code>). Preview opens{' '}
            <code>/__preview/…</code> on this host.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={onGeneral}>
            <FormField label="Name" htmlFor="settings-site-name">
              <Input
                id="settings-site-name"
                required
                value={displayName}
                onChange={(event) => setName(event.target.value)}
              />
            </FormField>
            <FormField label="Production URL" htmlFor="settings-production-url">
              <Input
                id="settings-production-url"
                type="url"
                required
                placeholder="https://example.com"
                value={displayUrl}
                onChange={(event) => setProductionUrl(event.target.value)}
              />
            </FormField>
            <div>
              <Button type="submit" disabled={generalMutation.isPending}>
                {generalMutation.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Deployment target</CardTitle>
          <CardDescription>
            Provider is Dokploy. Without a target, releases are marked live
            without deploying.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={onTarget}>
            <FormField label="Provider" htmlFor="deployment-provider">
              <Input id="deployment-provider" value="Dokploy" readOnly />
            </FormField>
            <FormField label="Application ID" htmlFor="application-id">
              <Input
                id="application-id"
                data-testid="application-id"
                required
                value={displayAppId}
                onChange={(event) => setApplicationId(event.target.value)}
              />
            </FormField>
            <FormField label="Health check URL" htmlFor="health-check-url">
              <Input
                id="health-check-url"
                data-testid="health-check-url"
                type="url"
                placeholder="https://example.com/health"
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
                {targetMutation.isPending ? 'Saving…' : 'Save target'}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={targetMutation.isPending || !site.deploymentTarget}
                onClick={() => setClearTargetOpen(true)}
              >
                Clear target
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Site token</CardTitle>
          <CardDescription>
            Customer builds authenticate with <code>ARECA_SITE_TOKEN</code> and{' '}
            <code>ARECA_CMS_URL</code>. Rotating replaces the current token
            immediately.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {rotatedToken ? <TokenAlert token={rotatedToken} /> : null}
          <div>
            <ConfirmDialog
              title="Rotate site token?"
              description="The current token stops working immediately. Any build or pull that still uses the old token will fail until ARECA_SITE_TOKEN is updated with the new one."
              confirmLabel="Rotate token"
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
                {rotateMutation.isPending ? 'Rotating…' : 'Rotate token'}
              </Button>
            </ConfirmDialog>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="grid gap-1.5">
            <CardTitle>Collections</CardTitle>
            <CardDescription>
              {site.lastManifest
                ? `Last manifest synced (${manifestKeys.length} collection${manifestKeys.length === 1 ? '' : 's'}${manifestKeys.length ? `: ${manifestKeys.join(', ')}` : ''}).`
                : 'No manifest has been synced yet.'}
            </CardDescription>
          </div>
          <Button
            type="button"
            data-testid="add-collection"
            onClick={() => openCollectionDialog(null)}
          >
            <Plus />
            Add collection
          </Button>
        </CardHeader>
        <CardContent>
          {collectionsQuery.isError ? (
            <QueryError
              title="Could not load collections"
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
              caption="Collections"
            />
          ) : (
            <EmptyState
              icon={<Layers />}
              title="No collections"
              description="Add a collection or sync a site manifest."
            />
          )}
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle>Danger zone</CardTitle>
          <CardDescription>
            Permanently delete this site and its content.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ConfirmDialog
            title="Delete site?"
            description={`This permanently deletes "${site.name}" with all of its entries, media references, releases and settings. This cannot be undone.`}
            confirmLabel="Delete site"
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
              {deleteMutation.isPending ? 'Deleting…' : 'Delete site'}
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
        title="Clear deployment target?"
        description="Future releases will be marked live without deploying to Dokploy until a new target is saved."
        confirmLabel="Clear target"
        variant="destructive"
        onConfirm={async () => {
          await targetMutation.mutateAsync(null)
        }}
      />
    </div>
  )
}
