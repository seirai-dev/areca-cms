import type { DragEvent } from 'react'
import { useRef, useState } from 'react'
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { FileText, ImageIcon, Trash2, Upload, X } from 'lucide-react'
import { toast } from 'sonner'

import { ConfirmDialog } from '#/components/confirm-dialog'
import type { MediaAsset } from '#/components/editor/media-picker'
import { uploadAssetFile } from '#/components/editor/media-picker'
import { queryKeys } from '#/components/editor/query-keys'
import { assetFileUrl, errorMessage } from '#/components/editor/utils'
import { EmptyState } from '#/components/empty-state'
import { ListPagination } from '#/components/list-pagination'
import { PageHeader } from '#/components/page-header'
import { QueryError } from '#/components/query-error'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Skeleton } from '#/components/ui/skeleton'
import { useDebouncedValue } from '#/hooks/use-debounced-value'
import { cn } from '#/lib/utils'
import { deleteAssetFn, listAssetsFn, updateAssetFn } from '#/server/fn/assets'

export const Route = createFileRoute('/_app/sites/$siteId/media')({
  component: MediaPage,
})

type MediaRow = MediaAsset & { size?: number }

const PAGE_SIZE = 40
const EMPTY_ASSETS: MediaRow[] = []

function formatBytes(bytes: number | undefined) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return null
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function MediaPage() {
  const { site } = Route.useRouteContext()
  const organizationId = site.organizationId
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<MediaRow | null>(null)
  const [altDrafts, setAltDrafts] = useState<
    Record<string, string | undefined>
  >({})
  const debouncedSearch = useDebouncedValue(search.trim())

  const assetsQuery = useQuery({
    queryKey: [...queryKeys.assets(organizationId, debouncedSearch), offset],
    queryFn: () =>
      listAssetsFn({
        data: {
          organizationId,
          search: debouncedSearch || undefined,
          limit: PAGE_SIZE + 1,
          offset,
        },
      }),
    placeholderData: keepPreviousData,
  })

  async function invalidate() {
    await queryClient.invalidateQueries({
      queryKey: ['assets', organizationId],
    })
  }

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      for (const file of files) {
        await uploadAssetFile(file, organizationId)
      }
      return files.length
    },
    onSuccess: async (count) => {
      toast.success(count === 1 ? 'File uploaded' : `${count} files uploaded`)
      setOffset(0)
      await invalidate()
    },
    onError: (error) => toast.error(errorMessage(error, 'Upload failed')),
  })

  const updateMutation = useMutation({
    mutationFn: (input: { id: string; altText: string }) =>
      updateAssetFn({ data: input }),
    onSuccess: async (_result, input) => {
      toast.success('Alt text saved')
      setAltDrafts((prev) => {
        const next = { ...prev }
        delete next[input.id]
        return next
      })
      await invalidate()
    },
    onError: (error) =>
      toast.error(errorMessage(error, 'Could not save alt text')),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAssetFn({ data: { id } }),
    onSuccess: async () => {
      toast.success('Deleted')
      await invalidate()
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not delete')),
  })

  function startUpload(files: File[]) {
    if (!files.length) return
    uploadMutation.mutate(files)
  }

  function onDragEnter(event: DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    dragDepth.current += 1
    setDragging(true)
  }

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  function onDragLeave() {
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    startUpload([...event.dataTransfer.files])
  }

  const pageRows: MediaRow[] = assetsQuery.data ?? EMPTY_ASSETS
  const hasMore = pageRows.length > PAGE_SIZE
  const assets = hasMore ? pageRows.slice(0, PAGE_SIZE) : pageRows
  const searching = debouncedSearch !== ''

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Media"
        description="Images and files shared across this organization's sites."
        actions={
          <Button
            type="button"
            disabled={uploadMutation.isPending}
            onClick={() => inputRef.current?.click()}
          >
            <Upload />
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
        aria-label="Upload files"
        tabIndex={-1}
        onChange={(event) => {
          const files = [...(event.target.files ?? [])]
          event.target.value = ''
          startUpload(files)
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          aria-label="Search media"
          placeholder="Search by filename…"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setOffset(0)
          }}
          className="w-full sm:max-w-xs"
        />
        {search ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch('')
              setOffset(0)
            }}
          >
            <X />
            Clear search
          </Button>
        ) : null}
      </div>

      <div
        className={cn(
          'relative grid gap-4 rounded-lg transition-colors',
          dragging &&
            'outline-2 outline-dashed outline-offset-8 outline-primary bg-primary/5',
        )}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {dragging ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/80 text-sm font-medium">
            <span className="flex items-center gap-2 rounded-md border bg-card px-4 py-2 shadow-sm">
              <Upload className="size-4" />
              Drop files to upload
            </span>
          </div>
        ) : null}

        {assetsQuery.isError ? (
          <QueryError
            title="Could not load media"
            error={assetsQuery.error}
            onRetry={() => assetsQuery.refetch()}
            retrying={assetsQuery.isFetching}
          />
        ) : assetsQuery.isLoading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square" />
            ))}
          </div>
        ) : assets.length === 0 ? (
          searching ? (
            <EmptyState
              icon={<ImageIcon />}
              title="No matching files"
              description={`Nothing matches "${debouncedSearch}".`}
              action={
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setSearch('')
                    setOffset(0)
                  }}
                >
                  Clear search
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<ImageIcon />}
              title="No media yet"
              description="Use the Upload button or drag and drop images and PDFs here."
            />
          )
        ) : (
          <>
            <div
              className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
              aria-busy={assetsQuery.isFetching}
              style={{ opacity: assetsQuery.isFetching ? 0.7 : 1 }}
            >
              {assets.map((asset) => {
                const alt = altDrafts[asset.id] ?? asset.altText ?? ''
                const isImage = asset.mimeType.startsWith('image/')
                const dimensions =
                  asset.width && asset.height
                    ? `${asset.width}×${asset.height}`
                    : null
                const size = formatBytes(asset.size)
                const meta = [dimensions, size].filter(Boolean).join(' · ')
                return (
                  <div
                    key={asset.id}
                    className="grid gap-2"
                    data-testid={`media-card-${asset.originalFilename}`}
                  >
                    {isImage ? (
                      <img
                        src={assetFileUrl(asset.storageKey)}
                        alt={alt}
                        loading="lazy"
                        className="aspect-square w-full rounded-md bg-muted object-cover"
                      />
                    ) : (
                      <div
                        className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-md bg-muted text-muted-foreground"
                        aria-label={asset.originalFilename}
                      >
                        <FileText className="size-8" />
                        <span className="text-xs uppercase">
                          {asset.mimeType.split('/')[1] || 'file'}
                        </span>
                      </div>
                    )}
                    <p
                      className="truncate text-sm font-medium"
                      title={asset.originalFilename}
                    >
                      {asset.originalFilename}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {meta || '—'}
                    </p>
                    <Input
                      value={alt}
                      placeholder="Alt text"
                      aria-label={`Alt text for ${asset.originalFilename}`}
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
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(asset)}
                    >
                      <Trash2 />
                      Delete
                    </Button>
                  </div>
                )
              })}
            </div>
            <ListPagination
              offset={offset}
              limit={PAGE_SIZE}
              count={assets.length}
              hasMore={hasMore}
              onChange={setOffset}
              isFetching={assetsQuery.isFetching}
              noun="files"
            />
          </>
        )}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title="Delete this file?"
        description={
          deleteTarget
            ? `"${deleteTarget.originalFilename}" will be permanently removed. Files that are still used by an entry cannot be deleted.`
            : undefined
        }
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={async () => {
          if (deleteTarget) await deleteMutation.mutateAsync(deleteTarget.id)
        }}
      />
    </div>
  )
}
