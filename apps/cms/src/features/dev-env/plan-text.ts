import type { DevEnvWarning, PlanTitleCode } from '#/lib/dev-env'
import { uiLanguageName } from '#/lib/site-languages'
import { m } from '#/paraglide/messages'
import type { SlugCollision } from '#/server/dev-env/slug-collisions'

import { pluralForm } from './push-model'
import type { PushDetail, SchemaAction } from './push-model'

/**
 * Text the push screen and the copy toasts build from the stable codes and
 * params the server sends (docs/design/dev-environments.md). MCP gets the
 * English `message` instead; these functions never read it.
 */

/** The row title of a plan item whose title is a fixed label. */
const TITLE_TEXT: Record<PlanTitleCode, () => string> = {
  'site-languages': () => m.dev_push_languages_title(),
}

export function planTitleText(code: PlanTitleCode): string {
  return TITLE_TEXT[code]()
}

/** One push or copy warning, translated. */
export function warningText(warning: DevEnvWarning): string {
  switch (warning.code) {
    case 'section-entry-missing':
      return m.dev_push_warning_section_entry_missing({
        slug: warning.params.slug,
      })
    case 'collection-missing':
      return m.dev_push_warning_collection_missing({
        collectionKey: warning.params.collectionKey,
      })
    case 'reference-cleared':
      return warning.params.locale !== undefined
        ? m.dev_push_warning_reference_cleared_locale({
            field: warning.params.field,
            locale: warning.params.locale,
          })
        : m.dev_push_warning_reference_cleared({
            field: warning.params.field,
          })
    case 'link-cleared':
      return warning.params.locale !== undefined
        ? m.dev_push_warning_link_cleared_locale({
            field: warning.params.field,
            locale: warning.params.locale,
          })
        : m.dev_push_warning_link_cleared({
            field: warning.params.field,
          })
    case 'ready-not-pushed':
      return m.dev_push_warning_ready_not_pushed({
        details: warning.params.details,
      })
    case 'ready-not-copied':
      return m.dev_push_warning_ready_not_copied({
        details: warning.params.details,
      })
  }
}

/** A URL another entry holds: the main URL, or a localized one named by its language. */
export function slugTakenText(collision: SlugCollision): string {
  if (collision.locale === undefined) {
    return m.dev_push_reason_slug_taken_main({
      slug: collision.slug,
      title: collision.collidesWith,
    })
  }
  return m.dev_push_reason_slug_taken_locale({
    language: uiLanguageName(collision.locale),
    slug: collision.slug,
    title: collision.collidesWith,
  })
}

export function valuesText(count: number) {
  return pluralForm(count) === 'one'
    ? m.dev_push_values_one()
    : m.dev_push_values_other({ count })
}

export function entriesText(count: number) {
  return pluralForm(count) === 'one'
    ? m.dev_push_entries_one()
    : m.dev_push_entries_other({ count })
}

/** The leading words of a schema row's title: `Remove field 'excerpt'`, `Add collection`. */
export function schemaActionText(action: SchemaAction): string {
  switch (action.kind) {
    case 'add-collection':
      return m.dev_push_action_add_collection()
    case 'remove-collection':
      return m.dev_push_action_remove_collection()
    case 'change-collection':
      return m.dev_push_action_change_collection()
    case 'remove-fields': {
      const fields = action.fields.map((key) => `'${key}'`).join(', ')
      return pluralForm(action.fields.length) === 'one'
        ? m.dev_push_action_remove_fields_one({ fields })
        : m.dev_push_action_remove_fields_other({ fields })
    }
  }
}

/** The reason a scheduled production entry blocks a row. Names the titles when a schema item has them. */
export function scheduledReasonText(titles: readonly string[]): string {
  return titles.length > 0
    ? m.dev_push_reason_scheduled({ titles: titles.join(', ') })
    : m.dev_push_reason_scheduled_entry()
}

/** A secondary line of a row. */
export function detailText(detail: PushDetail): string {
  switch (detail.kind) {
    case 'keeps':
      return m.dev_push_detail_keeps({
        fields: detail.fields.map((key) => `'${key}'`).join(', '),
      })
    case 'archives':
      return detail.values === null
        ? m.dev_push_detail_archives_entries({
            entries: entriesText(detail.entries),
          })
        : m.dev_push_detail_archives({
            values: valuesText(detail.values),
            entries: entriesText(detail.entries),
          })
  }
}
