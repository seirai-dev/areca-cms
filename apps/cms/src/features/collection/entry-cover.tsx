import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileText } from '@phosphor-icons/react'

import type { MediaAsset } from '#/features/editor/media-upload'
import { queryKeys } from '#/components/editor/query-keys'
import { assetFileUrl } from '#/components/editor/utils'
import { cn } from '#/lib/utils'
import { getAssetFn } from '#/server/fn/assets'

/** One cached asset lookup per id (shared by covers, thumbs and the editor). */
export function useAsset(assetId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.asset(assetId ?? ''),
    queryFn: () => getAssetFn({ data: { id: assetId! } }),
    enabled: Boolean(assetId),
    staleTime: 5 * 60 * 1000,
  })
}

function firstLetter(title: string | undefined) {
  const match = title?.trim().match(/\p{L}|\p{N}/u)
  return match ? match[0].toUpperCase() : null
}

/**
 * Tinted placeholder for an entry without an image: the title's first letter
 * in large display type on a soft accent wash.
 */
function LetterTile({
  title,
  large,
  className,
}: {
  title?: string
  large?: boolean
  className?: string
}) {
  const letter = firstLetter(title)
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid place-content-center overflow-hidden bg-[linear-gradient(140deg,var(--color-accent-soft),color-mix(in_oklab,var(--color-accent-soft)_30%,var(--color-background-subtle)))] text-accent-text',
        className,
      )}
    >
      {letter ? (
        <span
          className={cn(
            'font-semibold tracking-[-0.03em] opacity-80 select-none',
            large ? 'text-[56px] leading-none' : 'text-[13px] leading-none',
          )}
        >
          {letter}
        </span>
      ) : (
        <FileText className={large ? 'size-8 opacity-60' : 'size-4 opacity-70'} />
      )}
    </span>
  )
}

/** 16:10 card cover from an image asset, or the letter placeholder. */
export function EntryCover({
  assetId,
  title,
  className,
}: {
  assetId: string | undefined
  title: string
  className?: string
}) {
  const assetQuery = useAsset(assetId)
  const asset = (assetQuery.data ?? null) as MediaAsset | null
  const [broken, setBroken] = useState(false)
  const image = asset && asset.mimeType.startsWith('image/') && !broken ? asset : null
  return (
    <div
      className={cn(
        'relative aspect-[16/10] w-full overflow-hidden bg-background-subtle',
        className,
      )}
    >
      {image ? (
        <img
          src={assetFileUrl(image.storageKey)}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
          className="absolute inset-0 size-full object-cover transition-transform duration-500 ease-(--ease-standard) group-hover:scale-[1.02] motion-reduce:transition-none"
        />
      ) : assetId && assetQuery.isLoading ? null : (
        <LetterTile title={title} large className="absolute inset-0" />
      )}
    </div>
  )
}

/**
 * Small square thumbnail for rows (cover image, else the letter tile, else a
 * document glyph). Default 36px keeps the old `EntryThumb` footprint.
 */
export function EntryThumb({
  assetId,
  title,
  size = 36,
  className,
}: {
  assetId: string | undefined
  title?: string
  size?: 32 | 36 | 40
  className?: string
}) {
  const assetQuery = useAsset(assetId)
  const asset = (assetQuery.data ?? null) as MediaAsset | null
  const [broken, setBroken] = useState(false)
  const box = size === 32 ? 'size-8' : size === 40 ? 'size-10' : 'size-9'

  if (asset && asset.mimeType.startsWith('image/') && !broken) {
    return (
      <img
        src={assetFileUrl(asset.storageKey)}
        alt=""
        onError={() => setBroken(true)}
        loading="lazy"
        className={cn(
          box,
          'shrink-0 rounded-[8px] border border-border-default bg-background-subtle object-cover',
          className,
        )}
      />
    )
  }
  if (title) {
    return (
      <LetterTile title={title} className={cn(box, 'shrink-0 rounded-[8px]', className)} />
    )
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        box,
        'flex shrink-0 items-center justify-center rounded-[8px] bg-background-subtle text-icon-muted',
        className,
      )}
    >
      <FileText className="size-4" />
    </span>
  )
}
