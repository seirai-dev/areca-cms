import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import { listAssetsFn } from '#/server/fn/assets'

import { MediaPickerDialog, type MediaAsset } from '../media-picker'
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

  const assetsQuery = useQuery({
    queryKey: queryKeys.assets(organizationId, ''),
    queryFn: () =>
      listAssetsFn({
        data: { organizationId, limit: 100, offset: 0 },
      }),
    enabled: Boolean(assetId),
  })

  const asset = ((assetsQuery.data ?? []) as MediaAsset[]).find(
    (item) => item.id === assetId,
  )

  return (
    <div className="flex flex-col gap-3">
      {asset ? (
        <div className="grid gap-1">
          <img
            src={assetFileUrl(asset.storageKey)}
            alt={asset.altText ?? asset.originalFilename}
            className="h-32 w-auto rounded-md border object-cover"
            data-testid="image-field-thumb"
          />
          <p className="text-sm text-muted-foreground">{asset.originalFilename}</p>
        </div>
      ) : assetId ? (
        <p className="text-sm text-muted-foreground">Asset {assetId}</p>
      ) : null}
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          Choose
        </Button>
        {assetId ? (
          <Button type="button" variant="ghost" onClick={() => onChange('')}>
            Clear
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
