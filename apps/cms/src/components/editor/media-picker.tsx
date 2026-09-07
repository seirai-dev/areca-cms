import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { EmptyState } from '#/components/empty-state'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { Skeleton } from '#/components/ui/skeleton'
import { listAssetsFn } from '#/server/fn/assets'

import { queryKeys } from './query-keys'
import { assetFileUrl, errorMessage } from './utils'

export type MediaAsset = {
  id: string
  storageKey: string
  originalFilename: string
  mimeType: string
  width: number | null
  height: number | null
  altText: string | null
}

export async function uploadAssetFile(
  file: File,
  organizationId: string,
  altText = '',
) {
  const body = new FormData()
  body.append('file', file)
  body.append('organizationId', organizationId)
  body.append('altText', altText)
  const response = await fetch('/api/assets/upload', {
    method: 'POST',
    body,
  })
  if (!response.ok) {
    throw new Error((await response.text()) || 'Upload failed')
  }
  return (await response.json()) as MediaAsset
}

export function MediaPickerDialog({
  open,
  onOpenChange,
  organizationId,
  onSelect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationId: string
  onSelect: (asset: MediaAsset) => void
}) {
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [search, setSearch] = useState('')

  const assetsQuery = useQuery({
    queryKey: queryKeys.assets(organizationId, search),
    queryFn: () =>
      listAssetsFn({
        data: { organizationId, search: search || undefined, limit: 60, offset: 0 },
      }),
    enabled: open,
  })

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadAssetFile(file, organizationId),
    onSuccess: async (asset) => {
      await queryClient.invalidateQueries({ queryKey: ['assets', organizationId] })
      toast.success('Uploaded')
      onSelect(asset)
      onOpenChange(false)
    },
    onError: (error) => toast.error(errorMessage(error, 'Upload failed')),
  })

  const assets = (assetsQuery.data ?? []) as MediaAsset[]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" data-testid="media-picker">
        <DialogHeader>
          <DialogTitle>Choose media</DialogTitle>
          <DialogDescription>Select an existing asset or upload a new file.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search files…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="max-w-xs"
          />
          <input
            ref={inputRef}
            type="file"
            accept="image/*,application/pdf"
            className="sr-only"
            data-testid="media-upload"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) uploadMutation.mutate(file)
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={uploadMutation.isPending}
            onClick={() => inputRef.current?.click()}
          >
            {uploadMutation.isPending ? 'Uploading…' : 'Upload'}
          </Button>
        </div>
        {assetsQuery.isLoading ? (
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square" />
            ))}
          </div>
        ) : assets.length === 0 ? (
          <EmptyState title="No assets" description="Upload an image to get started." />
        ) : (
          <div className="grid max-h-[50vh] grid-cols-3 gap-3 overflow-y-auto">
            {assets.map((asset) => (
              <button
                key={asset.id}
                type="button"
                className="overflow-hidden rounded-md border text-left hover:ring-2 hover:ring-ring"
                data-testid={`media-asset-${asset.id}`}
                onClick={() => {
                  onSelect(asset)
                  onOpenChange(false)
                }}
              >
                {asset.mimeType.startsWith('image/') ? (
                  <img
                    src={assetFileUrl(asset.storageKey)}
                    alt={asset.altText ?? asset.originalFilename}
                    className="aspect-square w-full object-cover"
                  />
                ) : (
                  <div className="flex aspect-square items-center justify-center bg-muted text-xs">
                    {asset.originalFilename}
                  </div>
                )}
                <p className="truncate px-2 py-1 text-xs">{asset.originalFilename}</p>
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
