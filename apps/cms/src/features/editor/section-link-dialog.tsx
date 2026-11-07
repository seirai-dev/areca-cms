import * as React from 'react'

import { Button } from '#/components/ui/button'
import { fieldClasses } from '#/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { EntryPill } from '#/features/collection/entry-pill'
import type { LiveMembership } from '#/features/golive/entry-live-state'
import { cn } from '#/lib/utils'
import { uiLanguageName } from '#/lib/site-languages'
import { m } from '#/paraglide/messages'
import type {
  SectionChangeWithLinks,
  SectionLinkUpdate,
} from '#/server/content/section-link-updates'

/**
 * The follow-up of a save that removed or renamed a heading links point to
 * (docs/design/rich-text-links.md, decision 21). Renames are updated together
 * with one button. For a removed heading the editor picks where its links go.
 * The save has already happened; closing the dialog changes nothing else.
 */

/** Choice for a removed heading: keep the links, point them at the page, or at another heading. */
const KEEP = 'keep'
const PAGE = 'page'
const HEADING_PREFIX = 'heading:'

export function SectionLinkDialog({
  changes,
  live,
  devSite = false,
  multilingual,
  pending,
  onApply,
  onClose,
}: {
  changes: SectionChangeWithLinks[]
  live: LiveMembership
  devSite?: boolean
  /** Shows the language of each change (a multilingual site). */
  multilingual: boolean
  pending: boolean
  onApply: (updates: SectionLinkUpdate[]) => void
  onClose: () => void
}) {
  const [choices, setChoices] = React.useState<Record<string, string>>({})
  const keyOf = (change: SectionChangeWithLinks) =>
    `${change.locale}|${change.from}`
  const updates = changes.flatMap<SectionLinkUpdate>((change) => {
    if (change.to !== null) {
      return [{ locale: change.locale, from: change.from, to: change.to }]
    }
    const choice = choices[keyOf(change)] ?? KEEP
    if (choice === KEEP) return []
    return [
      {
        locale: change.locale,
        from: change.from,
        to: choice === PAGE ? '' : choice.slice(HEADING_PREFIX.length),
      },
    ]
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md" data-testid="section-link-dialog">
        <DialogHeader>
          <DialogTitle>{m.editor_section_links_title()}</DialogTitle>
          <DialogDescription>
            {m.editor_section_links_description()}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          {changes.map((change) => {
            const editable = change.linkers.filter((linker) => linker.editable)
            const owned = change.linkers.filter((linker) => !linker.editable)
            return (
              <section
                key={keyOf(change)}
                className="grid gap-3 rounded-card border border-border-default p-4"
                data-testid="section-link-change"
                data-from={change.from}
                data-locale={change.locale}
              >
                <div className="grid gap-1">
                  {multilingual && change.locale !== '' ? (
                    <p className="text-caption font-medium text-text-muted">
                      {uiLanguageName(change.locale)}
                    </p>
                  ) : null}
                  <p className="text-callout font-medium text-text-default">
                    {change.linkers.length === 1
                      ? m.editor_section_links_count_one({
                          heading: change.fromText,
                        })
                      : m.editor_section_links_count_other({
                          count: change.linkers.length,
                          heading: change.fromText,
                        })}
                  </p>
                  {change.to !== null ? (
                    <p className="text-caption text-text-muted">
                      {m.editor_section_links_renamed({
                        heading: change.toText ?? change.to,
                      })}
                    </p>
                  ) : (
                    <p className="text-caption text-text-muted">
                      {m.editor_section_links_removed()}
                    </p>
                  )}
                </div>

                {change.to === null ? (
                  <select
                    aria-label={m.editor_section_links_removed()}
                    data-testid="section-link-choice"
                    className={cn(fieldClasses, 'h-9')}
                    value={choices[keyOf(change)] ?? KEEP}
                    onChange={(event) =>
                      setChoices((current) => ({
                        ...current,
                        [keyOf(change)]: event.target.value,
                      }))
                    }
                  >
                    <option value={KEEP}>
                      {m.editor_section_links_keep()}
                    </option>
                    <option value={PAGE}>
                      {m.editor_section_links_page()}
                    </option>
                    {change.headings.map((heading) => (
                      <option
                        key={heading.id}
                        value={`${HEADING_PREFIX}${heading.id}`}
                      >
                        {heading.text}
                      </option>
                    ))}
                  </select>
                ) : null}

                <ul className="grid gap-2" data-testid="section-link-linkers">
                  {editable.map((linker) => (
                    <LinkerRow
                      key={`${linker.id}|${linker.locale}`}
                      linker={linker}
                      live={live}
                      devSite={devSite}
                    />
                  ))}
                </ul>

                {owned.length > 0 ? (
                  <div className="grid gap-2">
                    <p className="text-caption text-text-muted">
                      {m.editor_section_links_owner_only()}
                    </p>
                    <ul
                      className="grid gap-2"
                      data-testid="section-link-owner-only"
                    >
                      {owned.map((linker) => (
                        <LinkerRow
                          key={`${linker.id}|${linker.locale}`}
                          linker={linker}
                          live={live}
                          devSite={devSite}
                        />
                      ))}
                    </ul>
                  </div>
                ) : null}
              </section>
            )
          })}
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {m.editor_section_links_keep()}
          </Button>
          <Button
            onClick={() => onApply(updates)}
            disabled={pending || updates.length === 0}
            data-testid="section-link-update-all"
          >
            {m.editor_section_links_update_all()}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function LinkerRow({
  linker,
  live,
  devSite,
}: {
  linker: SectionChangeWithLinks['linkers'][number]
  live: LiveMembership
  devSite: boolean
}) {
  return (
    <li
      className="flex flex-wrap items-center justify-between gap-2 text-callout"
      data-testid="section-link-linker"
      data-entry-id={linker.id}
    >
      <span className="font-medium text-text-default">{linker.title}</span>
      <EntryPill
        entry={{
          id: linker.id,
          status: linker.status,
          updatedAt: linker.updatedAt,
          scheduledAt: linker.scheduledAt,
          publishedSlug: linker.publishedSlug,
          slug: linker.slug,
          editedSinceReady: linker.editedSinceReady,
        }}
        live={live}
        devSite={devSite}
      />
    </li>
  )
}
