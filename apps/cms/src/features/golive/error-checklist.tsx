import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { WarningCircle } from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'
import { m } from '#/paraglide/messages'
import { listEntriesFn } from '#/server/fn/content'

import { parseGoLiveError } from './parse-errors'
import type { GoLiveError } from './parse-errors'

/**
 * Failed go-live attempts can be dismissed. Blockers come from the server and
 * clear on their own, so they have no dismiss control.
 */
export function ErrorChecklist({
  siteId,
  errors,
  onDismiss,
}: {
  siteId: string
  errors: string[]
  onDismiss?: () => void
}) {
  const parsed = errors.map(parseGoLiveError)
  return (
    <div
      role="alert"
      data-testid="golive-errors"
      className="grid gap-3 rounded-[14px] bg-status-error-bg px-4 py-3.5"
    >
      <div className="flex items-center gap-2">
        <WarningCircle weight="fill" className="size-[18px] text-icon-error" />
        <span className="flex-1 text-[14px] leading-5 font-semibold text-text-primary">
          {m.golive_fix_first()}
        </span>
        {onDismiss ? (
          <Button type="button" variant="quiet" size="xs" onClick={onDismiss}>
            {m.golive_dismiss()}
          </Button>
        ) : null}
      </div>
      <ul className="grid gap-1.5">
        {parsed.map((error) => (
          <ErrorItem key={error.raw} siteId={siteId} error={error} />
        ))}
      </ul>
    </div>
  )
}

function ErrorItem({ siteId, error }: { siteId: string; error: GoLiveError }) {
  const lookup = useQuery({
    queryKey: ['golive-error-entry', siteId, error.collection, error.slug],
    queryFn: async () => {
      const result = await listEntriesFn({
        data: {
          siteId,
          collectionKey: error.collection!,
          search: error.slug,
          limit: 10,
          offset: 0,
        },
      })
      return result.items.find((item) => item.slug === error.slug) ?? null
    },
    enabled: Boolean(error.collection && error.slug),
    staleTime: 60_000,
  })
  const found = lookup.data
  return (
    <li className="flex items-start gap-2.5 text-callout">
      <span
        aria-hidden="true"
        className="mt-[5px] size-2 shrink-0 rounded-[3px] border-[1.5px] border-text-error"
      />
      <span className="min-w-0 text-text-primary">
        {error.slug ? (
          found ? (
            <Link
              to="/sites/$siteId/c/$collectionKey/$entryId"
              params={{
                siteId,
                collectionKey: error.collection!,
                entryId: found.id,
              }}
              className="font-medium text-text-accent hover:underline"
            >
              {error.slug}
            </Link>
          ) : (
            <span className="font-medium">{error.slug}</span>
          )
        ) : null}
        {error.field ? (
          <span className="text-text-secondary">
            {error.slug ? ' · ' : ''}
            {error.field}
          </span>
        ) : null}
        {error.slug || error.field ? ': ' : ''}
        <span className="text-text-secondary">{error.message}</span>
      </span>
    </li>
  )
}
