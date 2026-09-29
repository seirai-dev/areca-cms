// LEGACY (phase 1 bridge): replaced in phase 2
import type { DragEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { toast } from 'sonner'

import { ConfirmDialog } from '#/components/ui/confirm-dialog'
import { uploadAssetFile } from '#/components/editor/media-picker'
import { queryKeys } from '#/components/editor/query-keys'
import { errorMessage } from '#/components/editor/utils'
import { EmptyState } from '#/components/ui/empty-state'
import { ListPagination } from '#/components/list-pagination'
import { AssetPreview } from '#/components/media/asset-panel'
import { AssetTable } from '#/components/media/asset-table'
import type { MediaRow } from '#/components/media/types'
import { PageHeader } from '#/components/ui/page-header'
import { QueryError } from '#/components/ui/query-error'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Skeleton } from '#/components/ui/skeleton'
import { Spinner } from '#/components/ui/spinner'
import { useDebouncedValue } from '#/hooks/use-debounced-value'
import { canManageSite } from '#/lib/site-nav'
import type { MeSite } from '#/lib/site-nav'
import type { Me } from '#/server/fn/me'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import { deleteAssetFn, listAssetsFn } from '#/server/fn/assets'
import { Image, MagnifyingGlass, UploadSimple, X } from '@phosphor-icons/react'

const PAGE_SIZE = 40
const EMPTY_ASSETS: MediaRow[] = []

/** True from `lg` up, where the preview panel is a column rather than a drawer. */
function useIsWide() {
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 1024px)')
    const onChange = () => setWide(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return wide
}

/**
 * Organization-wide media library: a table of assets with drag-and-drop
 * upload. Selecting a row opens the preview panel beside the table (a drawer
 * below `lg`) with the preview, metadata and alt text.
 */
export function LegacyLibrary({ site, me }: { site: MeSite; me: Me }) {
  const organizationId = site.organizationId
  const canDelete = canManageSite(me, organizationId)
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const wide = useIsWide()
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<MediaRow | null>(null)
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
      toast.success(
        count === 1
          ? m.sites_file_uploaded()
          : m.sites_files_uploaded({ count }),
      )
      setOffset(0)
      await invalidate()
    },
    onError: (error) =>
      toast.error(errorMessage(error, m.sites_upload_failed())),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAssetFn({ data: { id } }),
    onSuccess: async () => {
      toast.success(m.sites_media_deleted())
      setActiveId(null)
      await invalidate()
    },
    onError: (error) =>
      toast.error(errorMessage(error, m.sites_delete_failed())),
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
  const active = assets.find((asset) => asset.id === activeId) ?? null
  const showPanelColumn = wide && active !== null

  return (
    <div
      className="relative grid gap-6"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <PageHeader
        title={m.shell_nav_library()}
        description={m.library_shared_description({ client: site.organizationName })}
        actions={
          <Button
            type="button"
            data-testid="media-upload"
            disabled={uploadMutation.isPending}
            onClick={() => inputRef.current?.click()}
          >
            {uploadMutation.isPending ? <Spinner /> : <UploadSimple />}
            {uploadMutation.isPending ? m.sites_uploading() : m.sites_upload()}
          </Button>
        }
      />
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
        multiple
        className="sr-only"
        aria-label={m.sites_upload_files()}
        tabIndex={-1}
        onChange={(event) => {
          const files = [...(event.target.files ?? [])]
          event.target.value = ''
          startUpload(files)
        }}
      />

      {dragging ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-surface border-2 border-dashed border-action-primary bg-background-default/85">
          <div className="flex flex-col items-center gap-1 text-center">
            <UploadSimple className="size-6 text-icon-accent" />
            <p className="text-ds-heading-5 text-text-primary">
              {m.media_drop_title()}
            </p>
            <p className="text-ds-body-sm text-text-secondary">
              {m.media_drop_hint()}
            </p>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:max-w-xs">
          <MagnifyingGlass className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-icon-muted" />
          <Input
            type="search"
            aria-label={m.sites_search_media()}
            placeholder={m.sites_search_filename_placeholder()}
            className="pl-9"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setOffset(0)
            }}
          />
        </div>
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
            {m.sites_clear_search()}
          </Button>
        ) : null}
      </div>

      <div
        className={cn(
          'grid items-start gap-8',
          showPanelColumn && 'lg:grid-cols-[minmax(0,1fr)_360px]',
        )}
      >
        <div className="grid min-w-0 gap-4">
          {assetsQuery.isError ? (
            <QueryError
              title={m.sites_media_load_error()}
              error={assetsQuery.error}
              onRetry={() => assetsQuery.refetch()}
              retrying={assetsQuery.isFetching}
            />
          ) : assetsQuery.isLoading ? (
            <div className="grid gap-px">
              <Skeleton className="h-10 w-full" />
              {Array.from({ length: 8 }).map((_, index) => (
                <Skeleton key={index} className="h-11 w-full" />
              ))}
            </div>
          ) : assets.length === 0 ? (
            searching ? (
              <EmptyState
                icon={<Image weight="duotone" />}
                title={m.sites_no_matching_files()}
                description={m.sites_nothing_matches({
                  search: debouncedSearch,
                })}
                action={
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setSearch('')
                      setOffset(0)
                    }}
                  >
                    {m.sites_clear_search()}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={<Image weight="duotone" />}
                title={m.sites_no_media_yet()}
                description={m.sites_no_media_description()}
                action={
                  <Button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                  >
                    <UploadSimple />
                    {m.sites_upload()}
                  </Button>
                }
              />
            )
          ) : (
            <>
              <div
                aria-busy={assetsQuery.isFetching}
                className={cn(
                  'transition-opacity',
                  assetsQuery.isFetching && 'opacity-70',
                )}
              >
                <AssetTable
                  assets={assets}
                  activeId={activeId}
                  onSelect={(asset) =>
                    setActiveId((current) =>
                      current === asset.id ? null : asset.id,
                    )
                  }
                />
              </div>
              <ListPagination
                offset={offset}
                limit={PAGE_SIZE}
                count={assets.length}
                hasMore={hasMore}
                onChange={setOffset}
                isFetching={assetsQuery.isFetching}
                noun={m.sites_files_noun()}
                nounSingular={m.sites_file_noun()}
              />
            </>
          )}
        </div>

        <AssetPreview
          asset={active}
          compact={!wide}
          canDelete={canDelete}
          onClose={() => setActiveId(null)}
          onDelete={() => active && setDeleteTarget(active)}
          onSaved={invalidate}
        />
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title={m.sites_delete_file_title()}
        description={
          deleteTarget
            ? m.sites_delete_file_description({
                filename: deleteTarget.originalFilename,
              })
            : undefined
        }
        confirmLabel={m.sites_delete()}
        variant="destructive"
        onConfirm={async () => {
          if (deleteTarget) await deleteMutation.mutateAsync(deleteTarget.id)
        }}
      />
    </div>
  )
}
