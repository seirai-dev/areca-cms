import { z } from '#/lib/zod'

import { LOCALE_TAG_MAX_LENGTH, MAX_SITE_LANGUAGES } from '#/lib/content-limits'
import { languageName } from '#/server/content/locale-validation'
import { setSiteLanguages } from '#/server/admin/site-languages'

import type { ToolCollector } from '../tool-kit'
import { languageSummary } from './site'

const languageCode = z.string().min(1).max(LOCALE_TAG_MAX_LENGTH)

/** Agency-only: the languages a site publishes in, and its main language. */
export function registerLanguageTools(registry: ToolCollector): void {
  registry.add({
    name: 'set_site_languages',
    title: 'Set site languages',
    description:
      'Agency admin only. Sets the languages this site publishes in and its main language. main is the fallback: visitors get it when a translation is missing, and it is the language of the shared base values. all lists the languages in the order the site shows them, and must include main. Codes are BCP 47 (e.g. "nl", "en", "nl-BE"). Removing a language hides it: it stops shipping and leaves the editor, but its text stays in the entries and comes back if you add it again. Changing main deletes nothing, but entries and sections that are not complete in the new main language cannot be marked ready until they are; the result counts them as gaps. Languages cannot be turned off once set: reduce to one language instead. Returns the languages, their English names and the gaps.',
    inputSchema: z.object({
      main: languageCode.describe(
        'The main language code, e.g. "nl". Must be one of all.',
      ),
      all: z
        .array(languageCode)
        .min(1)
        .max(MAX_SITE_LANGUAGES)
        .describe(
          'Every language of the site, in display order, e.g. ["nl", "en"].',
        ),
    }),
    access: 'agency',
    deniedMessage:
      'Only agency admins can change the site languages. Ask an agency admin.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
    run: async (input, actor) => {
      const { languages, gaps } = await setSiteLanguages(
        actor.siteId,
        { main: input.main, all: input.all },
        actor.userId,
      )
      const summary = languageSummary(languages)
      return {
        languages: summary,
        gaps,
        message:
          gaps > 0
            ? `${gaps} entries or sections are not complete in ${languageName(languages.main, summary.names)} yet. They show "Needs ${languageName(languages.main, summary.names)}" and cannot be marked ready until they are filled in.`
            : 'Languages saved. Every entry and section is complete in the main language.',
      }
    },
  })
}
