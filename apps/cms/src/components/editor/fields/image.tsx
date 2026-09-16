import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ImageIcon } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { getAssetFn } from '#/server/fn/assets'
import { m } from '#/paraglide/messages'

import { MediaPickerDialog } from '../media-picker'
import type { MediaAsset } from '../media-picker'
import { queryKeys } from '../query-keys'
import { assetFileUrl } from '../utils'

export function ImageFieldInput({
  organizationId,
  value,
  onChange,
}: {
  organizationId: string
  value: unknown
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const assetId = typeof value === 'string' ? value : ''

  const assetQuery = useQuery({
    queryKey: queryKeys.asset(assetId),
    queryFn: () => getAssetFn({ data: { id: assetId } }),
    enabled: Boolean(assetId),
  })
  const asset = (assetQuery.data ?? null) as MediaAsset | null

  return (
    <div className="flex flex-col gap-3">
      {assetId ? (
        <div className="flex items-start gap-3">
          {asset ? (
            <img
              src={assetFileUrl(asset.storageKey)}
              alt={asset.altText ?? asset.originalFilename}
              className="h-28 w-auto max-w-56 rounded-md border object-cover"
              data-testid="image-field-thumb"
            />
          ) : (
            <div className="flex h-28 w-40 items-center justify-center rounded-md border bg-muted text-muted-foreground">
              <ImageIcon className="size-6" />
            </div>
          )}
          <div className="min-w-0 text-sm">
            {asset ? (
              <>
                <p
                  className="truncate font-medium"
                  title={asset.originalFilename}
                >
                  {asset.originalFilename}
                </p>
                {asset.width && asset.height ? (
                  <p className="text-muted-foreground">
                    {asset.width}×{asset.height}
                  </p>
                ) : null}
                {!asset.altText ? (
                  <p className="text-xs text-muted-foreground">
                    {m.editor_no_alt_text()}
                  </p>
                ) : null}
              </>
            ) : assetQuery.isLoading ? (
              <p className="text-muted-foreground">{m.editor_loading()}</p>
            ) : (
              <p className="text-destructive">{m.editor_image_deleted()}</p>
            )}
          </div>
        </div>
      ) : null}
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          <ImageIcon />
          {assetId ? m.editor_replace() : m.editor_choose()}
        </Button>
        {assetId ? (
          <Button type="button" variant="ghost" onClick={() => onChange('')}>
            {m.editor_clear()}
          </Button>
        ) : null}
      </div>
      <MediaPickerDialog
        open={open}
        onOpenChange={setOpen}
        organizationId={organizationId}
        onSelect={(next) => onChange(next.id)}
      />
    </div>
  )
}
