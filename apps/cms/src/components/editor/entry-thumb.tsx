import { useQuery } from '@tanstack/react-query'
import { getAssetFn } from '#/server/fn/assets'

import type { MediaAsset } from './media-picker'
import { queryKeys } from './query-keys'
import { assetFileUrl } from './utils'
import { FileText } from '@phosphor-icons/react'

/** Cover thumbnail for an entry row; falls back to a document glyph. */
export function EntryThumb({ assetId }: { assetId: string | undefined }) {
  const assetQuery = useQuery({
    queryKey: queryKeys.asset(assetId ?? ''),
    queryFn: () => getAssetFn({ data: { id: assetId! } }),
    enabled: Boolean(assetId),
    staleTime: 5 * 60 * 1000,
  })
  const asset = (assetQuery.data ?? null) as MediaAsset | null

  if (asset && asset.mimeType.startsWith('image/')) {
    return (
      <img
        src={assetFileUrl(asset.storageKey)}
        alt=""
        loading="lazy"
        className="size-9 shrink-0 rounded-[8px] border border-border-default bg-background-subtle object-cover"
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className="flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-background-subtle text-icon-muted"
    >
      <FileText className="size-4" />
    </span>
  )
}
