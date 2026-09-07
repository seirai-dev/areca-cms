import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'

import { ConfirmDialog } from '#/components/confirm-dialog'
import {
  uploadAssetFile,
  type MediaAsset,
} from '#/components/editor/media-picker'
import { queryKeys } from '#/components/editor/query-keys'
import { assetFileUrl, errorMessage } from '#/components/editor/utils'
import { EmptyState } from '#/components/empty-state'
import { PageHeader } from '#/components/page-header'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Skeleton } from '#/components/ui/skeleton'
import { deleteAssetFn, listAssetsFn, updateAssetFn } from '#/server/fn/assets'

export const Route = createFileRoute('/_app/sites/$siteId/media')({
  component: MediaPage,
})

function MediaPage() {
  const { site } = Route.useRouteContext()
  const organizationId = site.organizationId
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [search, setSearch] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [altDrafts, setAltDrafts] = useState<Record<string, string>>({})

  const assetsQuery = useQuery({
    queryKey: queryKeys.assets(organizationId, search),
    queryFn: () =>
      listAssetsFn({
        data: { organizationId, search: search || undefined, limit: 80, offset: 0 },
      }),
  })

  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey: ['assets', organizationId] })
  }

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      for (const file of files) {
        await uploadAssetFile(file, organizationId)
      }
    },
    onSuccess: async () => {
      toast.success('Uploaded')
      await invalidate()
    },
    onError: (error) => toast.error(errorMessage(error, 'Upload failed')),
  })

  const updateMutation = useMutation({
    mutationFn: (input: { id: string; altText: string }) =>
      updateAssetFn({ data: input }),
    onSuccess: async () => {
      toast.success('Alt text saved')
      await invalidate()
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not update')),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAssetFn({ data: { id } }),
    onSuccess: async () => {
      toast.success('Deleted')
      await invalidate()
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not delete')),
  })

  const assets = (assetsQuery.data ?? []) as MediaAsset[]

  return (
    <div className="grid gap-4">
      <PageHeader
        title="Media"
        description="Organization assets"
        actions={
          <Button
            type="button"
            disabled={uploadMutation.isPending}
            onClick={() => inputRef.current?.click()}
          >
            {uploadMutation.isPending ? 'Uploading…' : 'Upload'}
          </Button>
        }
      />
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        className="sr-only"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])]
          event.target.value = ''
          if (files.length) uploadMutation.mutate(files)
        }}
      />
      <Input
        placeholder="Search…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="max-w-xs"
      />
      {assetsQuery.isLoading ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square" />
          ))}
        </div>
      ) : assets.length === 0 ? (
        <EmptyState title="No assets" description="Upload images to use in entries." />
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {assets.map((asset) => {
            const alt = altDrafts[asset.id] ?? asset.altText ?? ''
            return (
              <div key={asset.id} className="grid gap-2 rounded-lg border p-2">
                {asset.mimeType.startsWith('image/') ? (
                  <img
                    src={assetFileUrl(asset.storageKey)}
                    alt={alt}
                    className="aspect-square w-full rounded-md object-cover"
                  />
                ) : (
                  <div className="flex aspect-square items-center justify-center bg-muted text-xs">
                    {asset.originalFilename}
                  </div>
                )}
                <p className="truncate text-sm font-medium">{asset.originalFilename}</p>
                <p className="text-xs text-muted-foreground">
                  {asset.width && asset.height
                    ? `${asset.width}×${asset.height}`
                    : '—'}
                </p>
                <Input
                  value={alt}
                  placeholder="Alt text"
                  onChange={(event) =>
                    setAltDrafts((prev) => ({
                      ...prev,
                      [asset.id]: event.target.value,
                    }))
                  }
                  onBlur={() => {
                    if (alt !== (asset.altText ?? '')) {
                      updateMutation.mutate({ id: asset.id, altText: alt })
                    }
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={() => setDeleteId(asset.id)}
                >
                  Delete
                </Button>
              </div>
            )
          })}
        </div>
      )}
      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null)
        }}
        title="Delete asset?"
        description="This cannot be undone if the file is not in use."
        confirmLabel="Delete"
        onConfirm={async () => {
          if (deleteId) await deleteMutation.mutateAsync(deleteId)
        }}
      />
    </div>
  )
}
