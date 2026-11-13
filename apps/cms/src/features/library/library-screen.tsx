import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  FilePdf,
  FileText,
  ImagesSquare,
  MagnifyingGlass,
  UploadSimple,
  X,
} from '@phosphor-icons/react'

import { queryKeys } from '#/lib/query-keys'
import { assetThumbnail } from '#/lib/content/utils'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { Input } from '#/components/ui/input'
import { SegmentedControl } from '#/components/ui/segmented-control'
import { PageHeader } from '#/components/ui/page-header'
import { QueryError } from '#/components/ui/query-error'
import { Skeleton } from '#/components/ui/skeleton'
import { Hint } from '#/components/ui/tooltip'
import { useDebouncedValue } from '#/hooks/use-debounced-value'
import { isAltMissing } from '#/lib/asset-alt'
import { FADE, SPRING_SMALL } from '#/lib/motion'
import { canManageSite } from '#/lib/site-nav'
import { isMultilingual, languageEndonym } from '#/lib/site-languages'
import type { SiteLanguages } from '#/lib/types'
import type { MeSite } from '#/lib/site-nav'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import { listMembersFn } from '#/server/fn/admin'
import type { Me } from '#/server/fn/me'

import { AssetDetail } from './asset-detail'
import {
  ACCEPTED_TYPES,
  isImage,
  isPdf,
  useAssetMutations,
  useLibraryAssets,
  useUploadQueue,
} from './use-library'
import type { LibraryAsset, UploadItem } from './use-library'

const GRID =
  'grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-2.5 sm:grid-cols-[repeat(auto-fill,minmax(168px,1fr))] sm:gap-3'

/**
 * `/sites/$siteId/library` (brief §3.8): the client's shared files as a
 * square grid. Upload is the primary action; files can be dropped anywhere
 * on the window. A tile opens the detail slide-over.
 *
 * Test ids: `library-page`, `library-grid`, `media-card-{filename}`,
 * `media-upload` (the file input), `media-upload-button`, `library-search`,
 * `library-load-more`, `library-drop-overlay`, `asset-drawer`.
 */
export function LibraryScreen({
  site,
  me,
  uploadRequested = false,
  onUploadRequestHandled,
  missingAltOnly = false,
  altLanguage = null,
  onFilterChange,
}: {
  site: MeSite
  me: Me
  /** Set by `?upload=1` (the palette's Upload): open the file picker once. */
  uploadRequested?: boolean
  onUploadRequestHandled?: () => void
  /** Only images without a description in `altLanguage` (`?alt=missing`). */
  missingAltOnly?: boolean
  /** The content language the description filter reads (`?lang=`). */
  altLanguage?: string | null
  onFilterChange?: (next: {
    missingAltOnly: boolean
    altLanguage: string | null
  }) => void
}) {
  const organizationId = site.organizationId
  const canDelete = canManageSite(me, organizationId)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [search, setSearch] = React.useState('')
  const needle = useDebouncedValue(search.trim())
  const mainLocale = site.languages?.main ?? null
  // The description filter reads one content language; null on a
  // single-language site, where the main description is the only one.
  const altLocale = altLanguage ?? mainLocale
  const library = useLibraryAssets(
    organizationId,
    needle,
    missingAltOnly
      ? { siteId: site.id, locale: altLocale ?? undefined }
      : undefined,
  )
  const uploads = useUploadQueue(organizationId)
  const mutations = useAssetMutations(organizationId)
  const [activeId, setActiveId] = React.useState<string | null>(null)
  const [detailOpen, setDetailOpen] = React.useState(false)
  const dragging = useWindowFileDrop(uploads.enqueue)

  // Uploader names come from the member list, which owners and admins can read.
  const members = useQuery({
    queryKey: queryKeys.members(organizationId),
    queryFn: () => listMembersFn({ data: { organizationId } }),
    enabled: canDelete,
    staleTime: 60_000,
  })
  const nameOf = React.useCallback(
    (userId: string | null | undefined) =>
      userId
        ? members.data?.find((member) => member.userId === userId)?.name
        : undefined,
    [members.data],
  )

  const active = library.assets.find((asset) => asset.id === activeId) ?? null
  const openPicker = () => inputRef.current?.click()

  React.useEffect(() => {
    if (!uploadRequested) return
    inputRef.current?.click()
    onUploadRequestHandled?.()
  }, [uploadRequested, onUploadRequestHandled])
  const searching = needle !== ''
  const total = library.assets.length
  const countLabel = library.hasNextPage
    ? m.library_count_more({ count: total })
    : total === 1
      ? m.library_count_one()
      : m.library_count_other({ count: total })

  return (
    <div className="grid gap-6" data-testid="library-page">
      <PageHeader
        title={m.shell_nav_library()}
        description={m.library_shared_description({
          client: site.organizationName,
        })}
        meta={
          library.isSuccess && total > 0 ? (
            <span className="tnum">{countLabel}</span>
          ) : undefined
        }
        actions={
          <>
            <div className="relative min-w-0 flex-1 sm:w-60 sm:flex-none">
              <MagnifyingGlass className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-icon-muted" />
              <Input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && search) {
                    event.preventDefault()
                    setSearch('')
                  }
                }}
                placeholder={m.library_search_placeholder()}
                aria-label={m.sites_search_media()}
                className="pl-9"
                data-shortcut-search
                data-testid="library-search"
              />
            </div>
            <Button
              type="button"
              onClick={openPicker}
              data-testid="media-upload-button"
            >
              <UploadSimple />
              {m.sites_upload()}
            </Button>
          </>
        }
      />
      {total > 0 || missingAltOnly ? (
        <LibraryFilters
          languages={site.languages}
          altLocale={altLocale}
          missingAltOnly={missingAltOnly}
          onChange={(next) => onFilterChange?.(next)}
        />
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        multiple
        className="sr-only"
        aria-label={m.sites_upload_files()}
        tabIndex={-1}
        data-testid="media-upload"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])]
          event.target.value = ''
          uploads.enqueue(files)
        }}
      />

      {library.isError ? (
        <QueryError title={m.sites_media_load_error()} query={library} />
      ) : library.isPending ? (
        <div className={GRID} aria-hidden="true">
          {Array.from({ length: 12 }).map((_, index) => (
            <Skeleton key={index} className="aspect-square rounded-thumb" />
          ))}
        </div>
      ) : missingAltOnly && total === 0 && uploads.items.length === 0 ? (
        <EmptyState
          tone="neutral"
          icon={<ImagesSquare weight="duotone" />}
          title={m.library_missing_alt_empty_title()}
          description={
            altLocale
              ? m.library_missing_alt_empty_description({
                  language: languageEndonym(altLocale),
                })
              : m.library_missing_alt_empty_description_single()
          }
          action={
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                onFilterChange?.({ missingAltOnly: false, altLanguage })
              }
            >
              {m.library_missing_alt_show_all()}
            </Button>
          }
          data-testid="library-missing-alt-empty"
        />
      ) : total === 0 && uploads.items.length === 0 ? (
        searching ? (
          <EmptyState
            icon={<MagnifyingGlass />}
            tone="neutral"
            title={m.library_no_results_title({ search: needle })}
            description={m.library_no_results_description()}
            action={
              <Button
                type="button"
                variant="secondary"
                onClick={() => setSearch('')}
              >
                <X />
                {m.sites_clear_search()}
              </Button>
            }
            data-testid="library-no-results"
          />
        ) : (
          <EmptyState
            card
            icon={<ImagesSquare weight="duotone" />}
            title={m.library_empty_title()}
            description={m.library_empty_description({
              client: site.organizationName,
            })}
            action={
              <Button type="button" variant="secondary" onClick={openPicker}>
                <UploadSimple />
                {m.sites_upload_files()}
              </Button>
            }
            data-testid="library-empty"
          />
        )
      ) : (
        <>
          <ul
            className={cn(
              GRID,
              'transition-opacity',
              library.isFetching && !library.isFetchingNextPage && 'opacity-80',
            )}
            aria-label={m.library_grid_label()}
            aria-busy={library.isFetching || undefined}
            data-testid="library-grid"
          >
            {uploads.items.map((item) => (
              <li key={item.id}>
                <UploadTile item={item} />
              </li>
            ))}
            {library.assets.map((asset, index) => (
              <li key={asset.id}>
                <AssetTile
                  asset={asset}
                  index={index}
                  missingAlt={isAltMissing(asset, altLocale, mainLocale)}
                  showAltHint={missingAltOnly}
                  selected={detailOpen && asset.id === activeId}
                  onOpen={() => {
                    setActiveId(asset.id)
                    setDetailOpen(true)
                  }}
                />
              </li>
            ))}
          </ul>
          {library.hasNextPage ? (
            <div className="flex justify-center">
              <Button
                type="button"
                variant="secondary"
                loading={library.isFetchingNextPage}
                onClick={() => void library.fetchNextPage()}
                data-testid="library-load-more"
              >
                {m.library_load_more()}
              </Button>
            </div>
          ) : null}
        </>
      )}

      <AssetDetail
        asset={active}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        canDelete={canDelete}
        uploaderName={nameOf(active?.createdBy)}
        mutations={mutations}
        siteId={site.id}
        languages={site.languages}
      />

      <DropOverlay visible={dragging} />
    </div>
  )
}

/**
 * The Library's filter row: "Missing description" (`?alt=missing`) and, on a
 * multilingual site, the content language the description filter reads.
 */
function LibraryFilters({
  languages,
  altLocale,
  missingAltOnly,
  onChange,
}: {
  languages: SiteLanguages | null
  altLocale: string | null
  missingAltOnly: boolean
  onChange: (next: {
    missingAltOnly: boolean
    altLanguage: string | null
  }) => void
}) {
  const multilingual = isMultilingual(languages)
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-2"
      data-testid="library-filters"
    >
      <Button
        type="button"
        size="sm"
        variant={missingAltOnly ? 'secondary' : 'ghost'}
        aria-pressed={missingAltOnly}
        onClick={() =>
          onChange({ missingAltOnly: !missingAltOnly, altLanguage: altLocale })
        }
        data-testid="library-missing-alt-filter"
      >
        <span
          aria-hidden="true"
          className="size-1.5 rounded-full bg-status-warning"
        />
        {m.library_missing_alt_toggle()}
      </Button>
      {multilingual && altLocale ? (
        <SegmentedControl
          aria-label={m.library_description_language()}
          value={altLocale}
          onValueChange={(next) =>
            onChange({ missingAltOnly, altLanguage: next })
          }
          options={languages.all.map((tag) => ({
            value: tag,
            label: languageEndonym(tag),
            testId: `library-alt-language-${tag}`,
          }))}
          data-testid="library-alt-language"
        />
      ) : null}
    </div>
  )
}

function AssetTile({
  asset,
  index,
  selected,
  onOpen,
  missingAlt,
  showAltHint = false,
}: {
  asset: LibraryAsset
  index: number
  selected: boolean
  onOpen: () => void
  /** No description in the selected content language. */
  missingAlt: boolean
  /** Keep the "No description" dot visible (the filter is on). */
  showAltHint?: boolean
}) {
  const reduce = useReducedMotion()
  const image = isImage(asset)
  return (
    <motion.div
      className="relative"
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        reduce ? FADE : { ...SPRING_SMALL, delay: Math.min(index, 10) * 0.03 }
      }
    >
      <button
        type="button"
        onClick={onOpen}
        title={asset.originalFilename}
        aria-label={asset.originalFilename}
        aria-haspopup="dialog"
        data-testid={`media-card-${asset.originalFilename}`}
        data-selected={selected || undefined}
        className={cn(
          'group/tile relative block aspect-square w-full overflow-hidden rounded-thumb bg-background-subtle text-left',
          // The hairline sits above the picture so image and file tiles share
          // one edge in both themes.
          'after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border after:border-border-default',
          'transition-[box-shadow,transform,border-color] duration-200 ease-(--ease-standard) hover:-translate-y-0.5 hover:shadow-raise motion-reduce:hover:translate-y-0',
          'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
          selected &&
            'shadow-[0_0_0_2px_var(--color-accent)] after:border-accent',
        )}
      >
        {image ? (
          <img
            {...assetThumbnail(asset, '(min-width: 640px) 240px, 50vw')}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            className="size-full object-cover transition-transform duration-300 ease-(--ease-standard) group-hover/tile:scale-[1.03] motion-reduce:group-hover/tile:scale-100"
          />
        ) : (
          <span className="flex size-full flex-col items-center justify-center gap-1.5 bg-background-surface px-3 pb-7">
            {isPdf(asset) ? (
              <FilePdf weight="duotone" className="size-12 text-icon-error" />
            ) : (
              <FileText weight="duotone" className="size-10 text-icon-muted" />
            )}
            {isPdf(asset) ? (
              <span className="sr-only">{m.library_pdf()}</span>
            ) : (
              <span className="text-[11px] leading-none font-semibold tracking-[0.06em] text-text-muted">
                {asset.mimeType.split('/')[1]?.toUpperCase()}
              </span>
            )}
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
        {missingAlt ? (
          <Hint label={m.library_no_description()} side="top">
            <span
              className={cn(
                'absolute top-2 right-2 grid size-3.5 place-content-center rounded-full bg-background-surface/90 transition-opacity duration-150',
                // Quiet by default; shown on hover/focus and while the header's
                // "need a description" filter is on.
                !showAltHint &&
                  'opacity-0 group-hover/tile:opacity-100 group-focus-visible/tile:opacity-100',
              )}
              data-testid="media-missing-alt"
            >
              <span className="size-1.5 rounded-full bg-status-warning" />
              <span className="sr-only">{m.library_no_description()}</span>
            </span>
          </Hint>
        ) : null}
      </button>
    </motion.div>
  )
}

/** A file on its way up: local preview, dimmed, with a progress ring. */
function UploadTile({ item }: { item: UploadItem }) {
  const size = 36
  const stroke = 3
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  return (
    <div
      className="relative aspect-square overflow-hidden rounded-thumb border border-dashed border-border-strong bg-background-subtle"
      data-testid="media-upload-tile"
      aria-label={item.name}
      role="status"
    >
      {item.preview ? (
        <img
          src={item.preview}
          alt=""
          className="size-full object-cover opacity-45 blur-[1px]"
        />
      ) : null}
      <div className="absolute inset-0 grid place-content-center justify-items-center gap-2">
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="-rotate-90"
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            className="stroke-border-strong"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={
              circumference * (1 - Math.max(0.04, item.progress))
            }
            className={cn(
              'stroke-accent transition-[stroke-dashoffset] duration-200',
              item.status === 'queued' && 'opacity-0',
            )}
          />
        </svg>
        <span className="rounded-full bg-background-surface/85 px-2 py-0.5 text-caption text-text-secondary tnum">
          {item.status === 'queued'
            ? m.library_waiting()
            : `${Math.round(item.progress * 100)}%`}
        </span>
      </div>
      <span className="absolute inset-x-0 bottom-0 truncate px-2.5 pb-2 text-[12px] leading-4 font-medium text-text-secondary">
        {item.name}
      </span>
    </div>
  )
}

/** Tracks files dragged over the window; drops enqueue them. */
function useWindowFileDrop(onFiles: (files: File[]) => void) {
  const [dragging, setDragging] = React.useState(false)
  const depth = React.useRef(0)
  const handler = React.useRef(onFiles)
  handler.current = onFiles

  React.useEffect(() => {
    const hasFiles = (event: DragEvent) =>
      Boolean(event.dataTransfer?.types.includes('Files'))
    const onEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth.current += 1
      setDragging(true)
    }
    const onOver = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }
    const onLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setDragging(false)
    }
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth.current = 0
      setDragging(false)
      handler.current([...(event.dataTransfer?.files ?? [])])
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  return dragging
}

function DropOverlay({ visible }: { visible: boolean }) {
  const reduce = useReducedMotion()
  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          key="drop"
          data-testid="library-drop-overlay"
          className="pointer-events-none fixed inset-0 z-overlay grid place-content-center bg-[color-mix(in_oklab,var(--color-background-default)_78%,transparent)] p-3 backdrop-blur-[3px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={FADE}
        >
          <div className="absolute inset-3 rounded-panel border-2 border-dashed border-accent" />
          <motion.div
            className="relative grid justify-items-center gap-3 text-center"
            initial={reduce ? false : { scale: 0.94, y: 6 }}
            animate={{ scale: 1, y: 0 }}
            transition={SPRING_SMALL}
          >
            <span className="grid size-16 place-content-center rounded-[20px] bg-accent text-accent-contrast shadow-float">
              <UploadSimple weight="bold" className="size-7" />
            </span>
            <p className="text-title-2 text-text-primary">
              {m.library_drop_overlay_title()}
            </p>
            <p className="max-w-[36ch] text-callout text-text-secondary">
              {m.library_drop_overlay_hint()}
            </p>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
