import * as React from 'react'
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  FilePdf,
  FileText,
  ImageSquare,
  MagnifyingGlass,
  UploadSimple,
} from '@phosphor-icons/react'
import { toast } from 'sonner'

import { assetThumbnail, errorMessage } from '#/lib/content/utils'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { EmptyState } from '#/components/ui/empty-state'
import { Input } from '#/components/ui/input'
import { QueryError } from '#/components/ui/query-error'
import { Skeleton } from '#/components/ui/skeleton'
import { useDebouncedValue } from '#/hooks/use-debounced-value'
import { FADE, SPRING_SMALL } from '#/lib/motion'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import { listAssetsFn } from '#/server/fn/assets'

import { MEDIA_ACCEPT, uploadAssetFile, isPickerImage } from './media-upload'
import type { MediaAsset } from './media-upload'
import { visiblePickerAssets } from './media-picker-pages'

export type { MediaAsset }

const PAGE = 40

/**
 * Pick a file from the client's Library (brief §3.5): a large dialog with the
 * Library's square grid, search, Upload (which selects the new file) and
 * drop-anywhere. "Load more" pages by 40.
 */
export function MediaPickerDialog({
  open,
  onOpenChange,
  organizationId,
  onSelect,
  imagesOnly = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationId: string
  onSelect: (asset: MediaAsset) => void
  /** Rich text images: hide PDFs. */
  imagesOnly?: boolean
}) {
  const queryClient = useQueryClient()
  const reduce = useReducedMotion()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [search, setSearch] = React.useState('')
  const debouncedSearch = useDebouncedValue(search.trim(), 250)
  const [dragging, setDragging] = React.useState(false)
  const dragDepth = React.useRef(0)

  const assetsQuery = useInfiniteQuery({
    queryKey: ['assets', organizationId, 'picker', debouncedSearch, imagesOnly],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      listAssetsFn({
        data: {
          organizationId,
          search: debouncedSearch || undefined,
          imagesOnly,
          limit: PAGE + 1,
          offset: pageParam,
        },
      }),
    getNextPageParam: (lastPage, _pages, offset) =>
      lastPage.length > PAGE ? offset + PAGE : undefined,
    enabled: open,
  })

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadAssetFile(file, organizationId),
    onSuccess: async (asset) => {
      await queryClient.invalidateQueries({
        queryKey: ['assets', organizationId],
      })
      toast.success(m.editor_uploaded())
      onSelect(asset)
      close()
    },
    onError: (error) =>
      toast.error(errorMessage(error, m.editor_upload_failed())),
  })

  const hasMore = assetsQuery.hasNextPage
  const visible = visiblePickerAssets(
    assetsQuery.data?.pages ?? [],
    PAGE,
  ) as MediaAsset[]

  function close() {
    setSearch('')
    setDragging(false)
    dragDepth.current = 0
    onOpenChange(false)
  }

  function pick(file: File | null | undefined) {
    if (!file || uploadMutation.isPending) return
    if (imagesOnly && !isPickerImage(file.type)) {
      toast.error(m.media_picker_image_required())
      return
    }
    uploadMutation.mutate(file)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
        else onOpenChange(true)
      }}
    >
      <DialogContent
        size="xl"
        className="flex h-[min(760px,calc(100dvh-2rem))] flex-col gap-4 overflow-hidden p-0 sm:max-w-[920px]"
        data-testid="media-picker"
        onDragEnter={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return
          event.preventDefault()
          dragDepth.current += 1
          setDragging(true)
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) event.preventDefault()
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (dragDepth.current === 0) setDragging(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          dragDepth.current = 0
          setDragging(false)
          pick(event.dataTransfer.files.item(0))
        }}
      >
        <div className="grid gap-4 px-6 pt-6">
          <DialogHeader>
            <DialogTitle>{m.editor_media_title()}</DialogTitle>
            <DialogDescription>
              {m.editor_media_description()}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <MagnifyingGlass className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-icon-muted" />
              <Input
                placeholder={m.editor_search_files_placeholder()}
                aria-label={m.editor_search_files()}
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                }}
                className="pl-9"
                data-testid="media-search"
              />
            </div>
            <input
              ref={inputRef}
              type="file"
              accept={
                imagesOnly
                  ? 'image/jpeg,image/png,image/webp,image/gif'
                  : MEDIA_ACCEPT
              }
              className="sr-only"
              tabIndex={-1}
              data-testid="media-upload"
              onChange={(event) => {
                const file = event.target.files?.item(0)
                event.target.value = ''
                pick(file)
              }}
            />
            <Button
              type="button"
              loading={uploadMutation.isPending}
              onClick={() => inputRef.current?.click()}
              data-testid="media-upload-button"
            >
              {uploadMutation.isPending ? null : <UploadSimple weight="bold" />}
              {uploadMutation.isPending
                ? m.editor_uploading()
                : m.editor_upload()}
            </Button>
          </div>
        </div>

        <div className="relative min-h-0 flex-1 overflow-y-auto px-6 pb-6 scroll-quiet">
          {assetsQuery.isLoading ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-3">
              {Array.from({ length: 10 }, (_, i) => (
                <Skeleton key={i} className="aspect-square rounded-[10px]" />
              ))}
            </div>
          ) : assetsQuery.isError ? (
            <QueryError
              error={assetsQuery.error}
              title={m.editor_could_not_load_media()}
              onRetry={() => void assetsQuery.refetch()}
              retrying={assetsQuery.isFetching}
            />
          ) : visible.length === 0 ? (
            <EmptyState
              icon={<ImageSquare weight="duotone" />}
              title={
                debouncedSearch
                  ? m.editor_no_files_match()
                  : m.editor_no_files_yet()
              }
              description={
                debouncedSearch
                  ? m.editor_try_different_search()
                  : m.editor_media_empty_description()
              }
              action={
                debouncedSearch ? null : (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => inputRef.current?.click()}
                  >
                    <UploadSimple weight="bold" />
                    {m.editor_upload()}
                  </Button>
                )
              }
            />
          ) : (
            <div className="grid gap-4">
              <div
                className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-3"
                role="listbox"
                aria-label={m.editor_media_title()}
              >
                {visible.map((asset, index) => (
                  <PickerTile
                    key={asset.id}
                    asset={asset}
                    index={index}
                    onPick={() => {
                      onSelect(asset)
                      close()
                    }}
                  />
                ))}
              </div>
              {hasMore ? (
                <div className="flex justify-center">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    loading={assetsQuery.isFetching}
                    onClick={() => void assetsQuery.fetchNextPage()}
                  >
                    {m.editor_load_more()}
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </div>

        <AnimatePresence>
          {dragging ? (
            <motion.div
              key="drop"
              className="pointer-events-none absolute inset-0 z-10 grid place-content-center rounded-panel bg-[color-mix(in_oklab,var(--color-background-elevated)_82%,transparent)] backdrop-blur-[2px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={FADE}
            >
              <div className="absolute inset-3 rounded-[16px] border-2 border-dashed border-accent" />
              <motion.div
                className="relative grid justify-items-center gap-3 text-center"
                initial={reduce ? false : { scale: 0.94, y: 6 }}
                animate={{ scale: 1, y: 0 }}
                transition={SPRING_SMALL}
              >
                <span className="grid size-14 place-content-center rounded-[18px] bg-accent text-accent-contrast shadow-float">
                  <UploadSimple weight="bold" className="size-6" />
                </span>
                <p className="text-headline text-text-primary">
                  {m.editor_drop_to_upload()}
                </p>
              </motion.div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  )
}

function PickerTile({
  asset,
  index,
  onPick,
}: {
  asset: MediaAsset
  index: number
  onPick: () => void
}) {
  const reduce = useReducedMotion()
  const image = asset.mimeType.startsWith('image/')
  const pdf = asset.mimeType === 'application/pdf'
  return (
    <motion.button
      type="button"
      role="option"
      aria-selected={false}
      title={asset.originalFilename}
      aria-label={asset.originalFilename}
      data-testid={`media-asset-${asset.id}`}
      onClick={onPick}
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        reduce ? FADE : { ...SPRING_SMALL, delay: Math.min(index, 10) * 0.03 }
      }
      className={cn(
        'group/tile relative block aspect-square w-full overflow-hidden rounded-[10px] border border-border-default bg-background-subtle text-left',
        'transition-[box-shadow,transform,border-color] duration-200 ease-(--ease-standard) hover:-translate-y-0.5 hover:border-accent hover:shadow-raise motion-reduce:hover:translate-y-0',
        'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
      )}
    >
      {image ? (
        <img
          {...assetThumbnail(asset, '200px')}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className="size-full object-cover transition-transform duration-300 ease-(--ease-standard) group-hover/tile:scale-[1.03] motion-reduce:group-hover/tile:scale-100"
        />
      ) : (
        <span className="flex size-full flex-col items-center justify-center gap-1.5 bg-background-surface px-3 pb-7">
          {pdf ? (
            <FilePdf weight="duotone" className="size-10 text-icon-error" />
          ) : (
            <FileText weight="duotone" className="size-10 text-icon-muted" />
          )}
          <span className="text-[11px] leading-none font-semibold tracking-[0.06em] text-text-muted">
            {(asset.mimeType.split('/')[1] ?? m.editor_file()).toUpperCase()}
          </span>
        </span>
      )}
      <span
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-0 truncate px-2.5 pt-6 pb-2 text-[12px] leading-4 font-medium',
          image
            ? 'bg-linear-to-t from-black/60 to-transparent text-white opacity-0 transition-opacity duration-200 group-hover/tile:opacity-100 group-focus-visible/tile:opacity-100'
            : 'text-text-secondary',
        )}
      >
        {asset.originalFilename}
      </span>
    </motion.button>
  )
}
