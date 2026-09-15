import { useRef, useState } from 'react'
import type { DragEvent } from 'react'
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { FileText, Loader2, Search, Upload } from 'lucide-react'
import { toast } from 'sonner'

import { EmptyState } from '#/components/empty-state'
import { QueryError } from '#/components/query-error'
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
import { useDebouncedValue } from '#/hooks/use-debounced-value'
import { cn } from '#/lib/utils'
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

const PAGE = 40

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
  const debouncedSearch = useDebouncedValue(search, 250)
  const [pages, setPages] = useState(1)
  const [dragging, setDragging] = useState(false)

  const limit = PAGE * pages
  const assetsQuery = useQuery({
    queryKey: queryKeys.assets(organizationId, debouncedSearch, limit),
    queryFn: () =>
      listAssetsFn({
        data: {
          organizationId,
          search: debouncedSearch || undefined,
          limit: limit + 1,
          offset: 0,
        },
      }),
    enabled: open,
    placeholderData: keepPreviousData,
  })

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadAssetFile(file, organizationId),
    onSuccess: async (asset) => {
      await queryClient.invalidateQueries({
        queryKey: ['assets', organizationId],
      })
      toast.success('Uploaded')
      onSelect(asset)
      onOpenChange(false)
    },
    onError: (error) => toast.error(errorMessage(error, 'Upload failed')),
  })

  const all = (assetsQuery.data ?? []) as MediaAsset[]
  const hasMore = all.length > limit
  const assets = hasMore ? all.slice(0, limit) : all

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files.item(0)
    if (file) uploadMutation.mutate(file)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setSearch('')
          setPages(1)
        }
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-3xl" data-testid="media-picker">
        <DialogHeader>
          <DialogTitle>Choose media</DialogTitle>
          <DialogDescription>
            Pick an existing file or upload a new one. You can also drop a file
            anywhere in this dialog.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search files…"
              aria-label="Search files"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setPages(1)
              }}
              className="pl-8"
            />
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/*,application/pdf"
            className="sr-only"
            data-testid="media-upload"
            onChange={(event) => {
              const file = event.target.files?.item(0)
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
            {uploadMutation.isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Upload />
            )}
            {uploadMutation.isPending ? 'Uploading…' : 'Upload'}
          </Button>
        </div>
        <div
          className={cn(
            'relative -m-1 rounded-lg p-1 transition-colors',
            dragging && 'bg-accent ring-2 ring-ring',
          )}
          onDragOver={(event) => {
            event.preventDefault()
            if (!dragging) setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          {assetsQuery.isLoading ? (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="aspect-square" />
              ))}
            </div>
          ) : assetsQuery.isError ? (
            <QueryError
              error={assetsQuery.error}
              title="Could not load media"
              onRetry={() => assetsQuery.refetch()}
              retrying={assetsQuery.isFetching}
            />
          ) : assets.length === 0 ? (
            <EmptyState
              icon={<Upload />}
              title={debouncedSearch ? 'No files match' : 'No files yet'}
              description={
                debouncedSearch
                  ? 'Try a different search, or upload a new file.'
                  : 'Upload an image or PDF to get started.'
              }
            />
          ) : (
            <div className="grid max-h-[55vh] grid-cols-3 gap-3 overflow-y-auto p-0.5 sm:grid-cols-4">
              {assets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  className="group overflow-hidden rounded-md border bg-card text-left outline-none focus-visible:ring-2 focus-visible:ring-ring hover:ring-2 hover:ring-ring"
                  data-testid={`media-asset-${asset.id}`}
                  title={asset.originalFilename}
                  onClick={() => {
                    onSelect(asset)
                    onOpenChange(false)
                  }}
                >
                  {asset.mimeType.startsWith('image/') ? (
                    <img
                      src={assetFileUrl(asset.storageKey)}
                      alt={asset.altText ?? asset.originalFilename}
                      loading="lazy"
                      className="aspect-square w-full bg-muted object-cover"
                    />
                  ) : (
                    <div className="flex aspect-square flex-col items-center justify-center gap-1 bg-muted text-muted-foreground">
                      <FileText className="size-6" />
                      <span className="text-[10px] uppercase">
                        {asset.mimeType.split('/')[1] ?? 'file'}
                      </span>
                    </div>
                  )}
                  <p className="truncate px-2 py-1.5 text-xs">
                    {asset.originalFilename}
                  </p>
                </button>
              ))}
              {hasMore ? (
                <div className="col-span-full flex justify-center py-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={assetsQuery.isFetching}
                    onClick={() => setPages((n) => n + 1)}
                  >
                    {assetsQuery.isFetching ? 'Loading…' : 'Load more'}
                  </Button>
                </div>
              ) : null}
            </div>
          )}
          {dragging ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-background/80 text-sm font-medium">
              Drop to upload
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
