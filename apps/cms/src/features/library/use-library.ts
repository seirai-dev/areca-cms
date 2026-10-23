import * as React from 'react'
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { toast } from 'sonner'

import type { MediaAsset } from '#/features/editor/media-upload'
import { errorMessage } from '#/lib/content/utils'
import { m } from '#/paraglide/messages'
import { deleteAssetFn, listAssetsFn, updateAssetFn } from '#/server/fn/assets'

/** A Library file: the picker's asset plus the list-only fields. */
export type LibraryAsset = MediaAsset & {
  size?: number | null
  createdAt?: string | Date
  createdBy?: string | null
  /** Alt text per language besides main (multilingual sites). */
  altI18n?: Record<string, string> | null
}

const LIBRARY_PAGE_SIZE = 40
export const ACCEPTED_TYPES =
  'image/jpeg,image/png,image/webp,image/gif,application/pdf'

export function isImage(asset: { mimeType: string }) {
  return asset.mimeType.startsWith('image/')
}

export function isPdf(asset: { mimeType: string }) {
  return asset.mimeType === 'application/pdf'
}

/** "2.4 MB", "830 KB", "512 B". */
export function formatBytes(bytes: number | undefined | null) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return null
  if (bytes < 1024) return m.sites_bytes({ size: bytes })
  if (bytes < 1024 * 1024)
    return m.sites_kb({ size: (bytes / 1024).toFixed(0) })
  return m.sites_mb({ size: (bytes / (1024 * 1024)).toFixed(1) })
}

/** "JPEG", "PNG", "PDF" from a mime type. */
export function fileKind(asset: {
  mimeType: string
  originalFilename: string
}) {
  const sub = asset.mimeType.split('/')[1]
  if (sub) return sub.replace(/^x-/, '').toUpperCase()
  const dot = asset.originalFilename.lastIndexOf('.')
  return dot > 0 ? asset.originalFilename.slice(dot + 1).toUpperCase() : ''
}

/** Only images without a description in one content language. */
export type MissingAltFilter = { siteId: string; locale?: string }

function libraryQueryKey(
  organizationId: string,
  search: string,
  missingAlt: MissingAltFilter | undefined,
) {
  // Shares the `['assets', organizationId]` prefix with the media picker so
  // one invalidation refreshes both.
  return [
    'assets',
    organizationId,
    'library',
    search,
    missingAlt ?? null,
  ] as const
}

/** Paged Library list ("Load more", 40 per page), newest first. */
export function useLibraryAssets(
  organizationId: string,
  search: string,
  missingAlt?: MissingAltFilter,
) {
  const query = useInfiniteQuery({
    queryKey: libraryQueryKey(organizationId, search, missingAlt),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      listAssetsFn({
        data: {
          organizationId,
          search: search || undefined,
          missingAlt,
          limit: LIBRARY_PAGE_SIZE + 1,
          offset: pageParam,
        },
      }) as Promise<LibraryAsset[]>,
    getNextPageParam: (lastPage, _pages, lastOffset) =>
      lastPage.length > LIBRARY_PAGE_SIZE
        ? lastOffset + LIBRARY_PAGE_SIZE
        : undefined,
  })
  const assets = React.useMemo(
    () =>
      (query.data?.pages ?? []).flatMap((page) =>
        page.slice(0, LIBRARY_PAGE_SIZE),
      ),
    [query.data],
  )
  return { ...query, assets }
}

/** POST to the upload route with progress events (fetch has none). */
function uploadWithProgress(
  file: File,
  organizationId: string,
  onProgress: (fraction: number) => void,
) {
  return new Promise<MediaAsset>((resolve, reject) => {
    const body = new FormData()
    body.append('file', file)
    body.append('organizationId', organizationId)
    body.append('altText', '')
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/assets/upload')
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as MediaAsset)
        } catch {
          reject(new Error(m.sites_upload_failed()))
        }
      } else {
        reject(new Error(xhr.responseText || m.sites_upload_failed()))
      }
    }
    xhr.onerror = () => reject(new Error(m.sites_upload_failed()))
    xhr.send(body)
  })
}

export type UploadItem = {
  id: string
  name: string
  /** Object URL for image previews while uploading. */
  preview: string | null
  progress: number
  status: 'queued' | 'uploading'
}

/**
 * Sequential multi-file upload queue. Pending files show as tiles with a
 * progress ring; when the queue drains, one toast sums it up ("File
 * uploaded", "3 files uploaded") and failures get their own "Upload failed".
 */
export function useUploadQueue(organizationId: string) {
  const queryClient = useQueryClient()
  const [items, setItems] = React.useState<UploadItem[]>([])
  const queue = React.useRef<Array<{ item: UploadItem; file: File }>>([])
  const running = React.useRef(false)
  const counts = React.useRef({ ok: 0 })

  const update = (id: string, patch: Partial<UploadItem>) =>
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    )

  const drop = (id: string) =>
    setItems((prev) => {
      const gone = prev.find((item) => item.id === id)
      if (gone?.preview) URL.revokeObjectURL(gone.preview)
      return prev.filter((item) => item.id !== id)
    })

  const run = React.useCallback(async () => {
    if (running.current) return
    running.current = true
    const finished: string[] = []
    while (queue.current.length > 0) {
      const next = queue.current.shift()!
      update(next.item.id, { status: 'uploading', progress: 0 })
      try {
        await uploadWithProgress(next.file, organizationId, (progress) =>
          update(next.item.id, { progress }),
        )
        counts.current.ok += 1
        update(next.item.id, { progress: 1 })
        finished.push(next.item.id)
      } catch (error) {
        toast.error(m.sites_upload_failed(), {
          description: `${next.item.name} · ${errorMessage(error, m.sites_upload_failed())}`,
        })
        drop(next.item.id)
      }
    }
    const ok = counts.current.ok
    counts.current.ok = 0
    running.current = false
    if (ok > 0) {
      toast.success(
        ok === 1
          ? m.sites_file_uploaded()
          : m.sites_files_uploaded({ count: ok }),
      )
      await queryClient.invalidateQueries({
        queryKey: ['assets', organizationId],
      })
    }
    finished.forEach(drop)
  }, [organizationId, queryClient])

  const enqueue = React.useCallback(
    (files: File[]) => {
      if (files.length === 0) return
      const added = files.map((file) => ({
        file,
        item: {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: file.name,
          preview: file.type.startsWith('image/')
            ? URL.createObjectURL(file)
            : null,
          progress: 0,
          status: 'queued' as const,
        },
      }))
      queue.current.push(...added)
      setItems((prev) => [
        ...added.map((entry) => entry.item).reverse(),
        ...prev,
      ])
      void run()
    },
    [run],
  )

  return { items, enqueue, busy: items.length > 0 }
}

/** Save alt text and delete, with the Library's toasts. */
export function useAssetMutations(organizationId: string) {
  const queryClient = useQueryClient()
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['assets', organizationId] })

  const saveAlt = useMutation({
    mutationFn: (input: {
      id: string
      altText: string
      /** A non-main language; absent writes the main alt text. */
      locale?: string
      siteId?: string
    }) => updateAssetFn({ data: input }),
    onSuccess: async () => {
      toast.success(m.sites_alt_text_saved())
      await invalidate()
    },
    onError: (error) =>
      toast.error(errorMessage(error, m.sites_alt_text_save_failed())),
  })

  const remove = useMutation({
    mutationFn: (id: string) => deleteAssetFn({ data: { id } }),
    onSuccess: async () => {
      toast.success(m.sites_media_deleted())
      await invalidate()
    },
    // Keeps the server's message, e.g. "Used by 2 entries" for files in use.
    onError: (error) =>
      toast.error(errorMessage(error, m.sites_delete_failed())),
  })

  return { saveAlt, remove }
}
