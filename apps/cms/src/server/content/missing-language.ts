import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import { entry } from '#/db/schema'
import { I18N_KEY, LOCALE_KEY, isTranslatable } from '#/lib/content-locale'
import type { LocaleCtx } from '#/lib/content-locale'

/**
 * "Not complete in this language" as one SQL predicate on the draft, so the
 * list filter pages in the database. It mirrors `localeStatus` (complete =
 * every required translatable field has a value in that language):
 * - the base language reads top-level values, every other language reads
 *   `$i18n[locale]`; the base is `$locale`, or the main language when unset;
 * - empty means null, blank text, an empty list or object, or a rich-text
 *   value with no text (a doc whose blocks are all empty paragraphs).
 *
 * `localeStatus` in `#/lib/content-locale` stays the reference for the
 * editor; `missing-language.test.ts` checks the two agree.
 */
export function notCompleteInLocale(locale: string, ctx: LocaleCtx): SQL {
  const required = ctx.fields.filter(
    (field) => field.required && isTranslatable(field),
  )
  // Nothing is required, so every entry is complete.
  if (required.length === 0) return sql`false`

  const isBase = sql`coalesce(nullif(${entry.draftData} ->> ${LOCALE_KEY}, ''), ${ctx.main}) = ${locale}`
  const checks = required.map((field) => {
    const value = sql`(case when ${isBase} then ${entry.draftData} -> ${field.key} else ${entry.draftData} -> ${I18N_KEY} -> ${locale} -> ${field.key} end)`
    return field.type === 'richtext' ? emptyRichText(value) : emptyValue(value)
  })
  return sql`(${sql.join(checks, sql` or `)})`
}

/** `isEmptyValue`: null, blank text, an empty list, or an empty object. */
function emptyValue(value: SQL): SQL {
  return sql`(${value} is null or ${value} in ('null'::jsonb, '[]'::jsonb, '{}'::jsonb) or (jsonb_typeof(${value}) = 'string' and (${value} #>> '{}') ~ '^\\s*$'))`
}

/** `isEmptyField` for rich text: an empty value, or a doc with no text blocks. */
function emptyRichText(value: SQL): SQL {
  const content = sql`(${value} -> 'content')`
  return sql`(${emptyValue(value)} or (
    jsonb_typeof(${value}) = 'object'
    and ${value} ->> 'type' = 'doc'
    and (
      ${content} is null
      or jsonb_typeof(${content}) = 'null'
      or (
        jsonb_typeof(${content}) = 'array'
        and (
          jsonb_array_length(${content}) = 0
          or not exists (
            select 1 from jsonb_array_elements(${content}) as block
            where not (
              jsonb_typeof(block) = 'object'
              and block ->> 'type' = 'paragraph'
              and (
                (block -> 'content') is null
                or (jsonb_typeof(block -> 'content') = 'array'
                    and jsonb_array_length(block -> 'content') = 0)
              )
            )
          )
        )
      )
    )
  ))`
}
