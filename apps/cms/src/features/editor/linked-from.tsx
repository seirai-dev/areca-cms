import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import { QueryError } from '#/components/ui/query-error'
import { Skeleton } from '#/components/ui/skeleton'
import { EntryPill } from '#/features/collection/entry-pill'
import type { LiveMembership } from '#/features/golive/entry-live-state'
import { queryKeys } from '#/lib/content/query-keys'
import { uiLanguageName } from '#/lib/site-languages'
import { m } from '#/paraglide/messages'
import { listLinkedFromFn } from '#/server/fn/content'
import type { LinkedFromSource } from '#/server/content/linked-from'

/**
 * "Linked from" in the entry editor's side panel (docs/design/rich-text-links.md,
 * decision 20): the entries and site sections whose rich text links to this
 * entry, per language, with the section each link goes to.
 */
export function LinkedFrom({
  siteId,
  entryId,
  live,
  devSite = false,
}: {
  siteId: string
  entryId: string
  live: LiveMembership
  devSite?: boolean
}) {
  const query = useQuery({
    queryKey: queryKeys.linkedFrom(entryId),
    queryFn: () => listLinkedFromFn({ data: { id: entryId } }),
  })

  if (query.isPending) return <Skeleton className="h-12" />
  if (query.isError) {
    return <QueryError query={query} />
  }
  const groups = query.data
  if (groups.length === 0) {
    return (
      <p
        className="text-callout text-text-muted"
        data-testid="linked-from-empty"
      >
        {m.editor_linked_from_empty()}
      </p>
    )
  }
  return (
    <div className="grid gap-4" data-testid="linked-from">
      {groups.map((group) => (
        <div
          key={group.locale || 'single'}
          className="grid gap-2"
          data-testid="linked-from-language"
          data-locale={group.locale}
        >
          {group.locale !== '' ? (
            <h3 className="text-caption font-medium text-text-muted">
              {uiLanguageName(group.locale)}
            </h3>
          ) : null}
          <ul className="grid gap-3">
            {group.sources.map((source) => (
              <li
                key={source.id}
                className="grid gap-1"
                data-testid="linked-from-source"
                data-entry-id={source.id}
              >
                <SourceLink siteId={siteId} source={source} />
                <div className="flex flex-wrap items-center gap-2 text-caption text-text-muted">
                  <span>
                    {source.kind === 'global'
                      ? m.editor_linked_from_site_content()
                      : source.collectionLabel}
                  </span>
                  <EntryPill
                    entry={{
                      id: source.id,
                      status: source.status,
                      updatedAt: source.updatedAt,
                      scheduledAt: source.scheduledAt,
                      publishedSlug: source.publishedSlug,
                      slug: source.slug,
                      editedSinceReady: source.editedSinceReady,
                    }}
                    live={live}
                    devSite={devSite}
                  />
                </div>
                <ul className="grid gap-0.5 text-caption text-text-muted">
                  {source.sections.map((section) => (
                    <li
                      key={section.anchor || 'page'}
                      data-testid="linked-from-section"
                    >
                      {section.anchor === ''
                        ? m.editor_linked_from_whole_page()
                        : (section.text ??
                          `#${section.anchor} (${m.editor_linked_from_section_missing()})`)}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

/** The row's title, a link to the source's editor. */
function SourceLink({
  siteId,
  source,
}: {
  siteId: string
  source: LinkedFromSource
}) {
  const className =
    'text-callout font-medium text-text-default underline-offset-2 hover:underline'
  if (source.kind === 'global') {
    return (
      <Link
        to="/sites/$siteId/globals/$globalKey"
        params={{ siteId, globalKey: source.collectionKey }}
        className={className}
      >
        {source.title}
      </Link>
    )
  }
  return (
    <Link
      to="/sites/$siteId/c/$collectionKey/$entryId"
      params={{
        siteId,
        collectionKey: source.collectionKey,
        entryId: source.id,
      }}
      className={className}
    >
      {source.title}
    </Link>
  )
}
