import { useQuery } from '@tanstack/react-query'

import { useAsset } from '#/features/collection/entry-cover'
import { assetFileUrl } from '#/lib/content/utils'
import { queryKeys } from '#/lib/content/query-keys'
import type { EntryData, Field } from '#/lib/types'
import { getEntryFn } from '#/server/fn/content'

import { RichTextPreview } from './rich-text/rich-text-preview'

/** Inspect the frozen approval without opening editable controls or changing the draft. */
export function ScheduledVersion({
  fields,
  data,
  slug,
  siteId,
  organizationId,
}: {
  fields: Field[]
  data: EntryData
  slug: string
  siteId: string
  organizationId: string
}) {
  return (
    <details
      className="mx-auto w-full max-w-[720px] rounded-card border border-border-default p-4"
      data-testid="scheduled-version"
    >
      <summary className="cursor-pointer text-callout font-medium text-text-primary">
        View approved scheduled version
      </summary>
      <div className="mt-4 grid gap-5">
        <p className="text-callout text-text-secondary">
          This content and address will be released when the schedule is due.
          Changes in the editor remain drafts until approved again.
        </p>
        <dl className="grid gap-5">
          <div className="grid gap-1">
            <dt className="text-overline text-text-muted">Approved address</dt>
            <dd className="break-words text-body text-text-primary">{slug}</dd>
          </div>
          {fields
            .filter((field) => field.type !== 'slug')
            .map((field) => (
              <div key={field.key} className="grid gap-1">
                <dt className="text-overline text-text-muted">{field.label}</dt>
                <dd className="min-w-0 whitespace-pre-wrap break-words text-body text-text-primary">
                  <ScheduledField
                    field={field}
                    value={data[field.key]}
                    siteId={siteId}
                    organizationId={organizationId}
                  />
                </dd>
              </div>
            ))}
        </dl>
      </div>
    </details>
  )
}

function ScheduledField({
  field,
  value,
  siteId,
  organizationId,
}: {
  field: Field
  value: unknown
  siteId: string
  organizationId: string
}) {
  if (value == null || value === '')
    return <span className="text-text-muted">No value</span>
  if (field.type === 'richtext') return <RichTextPreview value={value} />
  if (field.type === 'image' && typeof value === 'string')
    return <ScheduledImage id={value} organizationId={organizationId} />
  if (field.type === 'reference' && typeof value === 'string')
    return <ScheduledReference id={value} field={field} siteId={siteId} />
  if (typeof value === 'boolean') return <>{value ? 'Yes' : 'No'}</>
  if (typeof value === 'string' || typeof value === 'number')
    return <>{String(value)}</>
  return <span className="text-text-muted">Content unavailable</span>
}

function ScheduledImage({
  id,
  organizationId,
}: {
  id: string
  organizationId: string
}) {
  const query = useAsset(id)
  const image = query.data
  if (query.isPending) return <span role="status">Loading image…</span>
  if (!image || image.organizationId !== organizationId)
    return <span>Image unavailable</span>
  return (
    <figure className="grid gap-2">
      <img
        src={assetFileUrl(image.storageKey)}
        alt={image.altText ?? image.originalFilename}
        className="max-h-80 max-w-full rounded-[10px] object-contain"
      />
      <figcaption className="text-caption text-text-muted">
        {image.originalFilename}
      </figcaption>
    </figure>
  )
}

function ScheduledReference({
  id,
  field,
  siteId,
}: {
  id: string
  field: Field
  siteId: string
}) {
  const query = useQuery({
    queryKey: queryKeys.entry(id),
    queryFn: () => getEntryFn({ data: { id } }),
  })
  const target = query.data
  if (query.isPending) return <span role="status">Loading reference…</span>
  if (
    !target ||
    target.siteId !== siteId ||
    target.collectionKey !== field.collection
  )
    return <span>Reference unavailable</span>
  const name = target.draftData.title ?? target.draftData.name
  return <>{typeof name === 'string' ? name : target.slug}</>
}
