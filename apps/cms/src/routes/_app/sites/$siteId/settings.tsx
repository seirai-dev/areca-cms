import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { toast } from 'sonner'

import {
  CollectionFormDialog,
  type CollectionDraft,
} from '#/components/admin/collection-form-dialog'
import { adminQueryKeys, errorMessage } from '#/components/admin/helpers'
import { TableSkeleton } from '#/components/admin/table-skeleton'
import { TokenAlert } from '#/components/admin/token-alert'
import { EmptyState } from '#/components/empty-state'
import { FormField } from '#/components/form-field'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { listCollectionsFn, upsertCollectionFn } from '#/server/fn/content'
import {
  deleteSiteFn,
  getSiteFn,
  rotateSiteTokenFn,
  updateSiteFn,
} from '#/server/fn/admin'

export const Route = createFileRoute('/_app/sites/$siteId/settings')({
  beforeLoad: ({ context }) => {
    if (!context.me?.user.isAgencyAdmin) {
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
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState('')

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
      await queryClient.invalidateQueries({
        queryKey: adminQueryKeys.site(siteId),
      })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const targetMutation = useMutation({
    mutationFn: (deploymentTarget: {
      provider: 'dokploy'
      applicationId: string
      healthCheckUrl?: string
    } | null) => updateSite({ data: { id: siteId, deploymentTarget } }),
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
      applicationId: displayAppId,
      healthCheckUrl: displayHealth.trim() || undefined,
    })
  }

  if (siteQuery.isLoading) {
    return <TableSkeleton />
  }

  if (!site) {
    return <EmptyState title="Site not found" />
  }

  const manifestKeys = site.lastManifest
    ? Object.keys(site.lastManifest.collections)
    : []

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>Public site name and production URL.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid max-w-lg gap-4" onSubmit={onGeneral}>
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
                value={displayUrl}
                onChange={(event) => setProductionUrl(event.target.value)}
              />
            </FormField>
            <Button type="submit" disabled={generalMutation.isPending}>
              {generalMutation.isPending ? 'Saving…' : 'Save general'}
            </Button>
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
        <CardContent className="grid gap-4">
          <form className="grid max-w-lg gap-4" onSubmit={onTarget}>
            <FormField label="Provider">
              <Input value="dokploy" readOnly />
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
                onClick={() => targetMutation.mutate(null)}
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
            Customer builds use <code>ARECA_SITE_TOKEN</code> and{' '}
            <code>ARECA_CMS_URL</code>. Rotating replaces the current token
            immediately.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {rotatedToken ? <TokenAlert token={rotatedToken} /> : null}
          <ConfirmRotate
            pending={rotateMutation.isPending}
            onConfirm={async () => {
              await rotateMutation.mutateAsync()
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
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
            onClick={() => {
              setEditingCollection(null)
              requestAnimationFrame(() => setCollectionOpen(true))
            }}
          >
            Add collection
          </Button>
        </CardHeader>
        <CardContent>
          {collectionsQuery.isLoading ? (
            <TableSkeleton />
          ) : collectionsQuery.data?.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Key</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead>Fields</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {collectionsQuery.data.map((collection) => (
                  <TableRow key={collection.id}>
                    <TableCell>{collection.key}</TableCell>
                    <TableCell>{collection.label}</TableCell>
                    <TableCell>{collection.routePattern}</TableCell>
                    <TableCell>{collection.enabled ? 'Yes' : 'No'}</TableCell>
                    <TableCell>{collection.fields.length}</TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingCollection({
                            key: collection.key,
                            label: collection.label,
                            routePattern: collection.routePattern,
                            enabled: collection.enabled,
                            fields: collection.fields,
                          })
                          requestAnimationFrame(() => setCollectionOpen(true))
                        }}
                      >
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState
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
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              setDeleteConfirm('')
              setDeleteOpen(true)
            }}
          >
            Delete site
          </Button>
        </CardContent>
      </Card>

      <CollectionFormDialog
        open={collectionOpen}
        onOpenChange={setCollectionOpen}
        initial={editingCollection}
        pending={collectionMutation.isPending}
        onSubmit={(draft) => collectionMutation.mutate(draft)}
      />

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete site</DialogTitle>
            <DialogDescription>
              Type <strong>{site.slug}</strong> to confirm. This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <FormField label="Site slug" htmlFor="delete-site-slug">
            <Input
              id="delete-site-slug"
              value={deleteConfirm}
              onChange={(event) => setDeleteConfirm(event.target.value)}
            />
          </FormField>
          <DialogFooter>
            <Button
              type="button"
              variant="destructive"
              disabled={
                deleteConfirm !== site.slug || deleteMutation.isPending
              }
              onClick={() => deleteMutation.mutate()}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete site'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ConfirmRotate({
  pending,
  onConfirm,
}: {
  pending: boolean
  onConfirm: () => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        Rotate token
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rotate site token</DialogTitle>
            <DialogDescription>
              The current token will stop working. Store the new token in
              ARECA_SITE_TOKEN.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              disabled={pending}
              onClick={async () => {
                await onConfirm()
                setOpen(false)
              }}
            >
              {pending ? 'Rotating…' : 'Rotate token'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
