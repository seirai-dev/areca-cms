import { describe, expect, it } from 'vitest'

// The SDK's localize step, imported from source: the CMS does not depend on
// the package, and this module has only type imports.
import {
  defaultLocalizePath,
  localizeEntryLinks,
} from '../../../../../packages/site-sdk/src/entry-links.ts'

import { createEntry, publishEntry } from './entries.ts'
import { buildSnapshot } from './snapshot.ts'
import {
  cleanupTestSite,
  createTestCollection,
  createTestSite,
} from './test-utils.ts'

const hasDb = Boolean(process.env.DATABASE_URL)
const languages = { main: 'en', all: ['en', 'nl'] }

function body(
  heading: string,
  paragraph: { text: string; link?: Record<string, unknown> },
) {
  return {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: heading }],
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: paragraph.text,
            ...(paragraph.link
              ? {
                  marks: [
                    {
                      type: 'link',
                      attrs: { href: '/placeholder', ...paragraph.link },
                    },
                  ],
                }
              : {}),
          },
        ],
      },
    ],
  }
}

/**
 * English main with the `/journal` route; Dutch with `/journaal`. `english`
 * has no Dutch text. `dutch` has a Dutch translation. A Dutch source links to both.
 */
async function setup(suffix: string) {
  const ctx = await createTestSite({ languages })
  await createTestCollection(ctx.site.id, {
    key: 'articles',
    routePattern: '/journal/$slug',
    localizedRoutes: { nl: '/journaal/$slug' },
  })
  const english = await createEntry({
    siteId: ctx.site.id,
    collectionKey: 'articles',
    data: {
      title: 'English only',
      slug: `english-${suffix}`,
      body: body('Heading', { text: 'Read' }),
    },
    actorId: ctx.actor.id,
  })
  await publishEntry(english.id, ctx.actor.id)
  const dutch = await createEntry({
    siteId: ctx.site.id,
    collectionKey: 'articles',
    data: {
      title: 'Engels en Nederlands',
      slug: `dutch-${suffix}`,
      body: body('Kop', { text: 'Lees' }),
      $i18n: {
        nl: {
          title: 'Nederlands',
          $slug: `nederlands-${suffix}`,
          body: body('Kop', { text: 'Lees' }),
        },
      },
    },
    actorId: ctx.actor.id,
  })
  await publishEntry(dutch.id, ctx.actor.id)
  const source = await createEntry({
    siteId: ctx.site.id,
    collectionKey: 'articles',
    data: {
      title: 'Source',
      slug: `source-${suffix}`,
      body: body('Intro', { text: 'Read' }),
      $i18n: {
        nl: {
          title: 'Bron',
          body: body('Inleiding', {
            text: 'Lees',
            link: { entryId: english.id, collection: 'articles' },
          }),
        },
      },
    },
    actorId: ctx.actor.id,
  })
  await publishEntry(source.id, ctx.actor.id)
  return { ctx, english, dutch, source }
}

describe.skipIf(!hasDb)('CMS snapshot to SDK localize', () => {
  it('a Dutch text linking to an English-only entry keeps the main-language path', async () => {
    const { ctx, english, source } = await setup('en-only')
    try {
      const built = await buildSnapshot(ctx.site.id)
      if (!built.ok) throw new Error(built.errors.join('; '))
      const item = built.snapshot.collections.articles.find(
        (row) => row.id === source.id,
      )!
      const localized = localizeEntryLinks(
        item as never,
        languages,
        defaultLocalizePath('en'),
      )
      const nl = (
        localized as unknown as {
          locales: Record<string, { data: { body: { html: string } } }>
        }
      ).locales.nl.data.body
      expect(nl.html).toContain(
        `<a href="/journal/english-en-only" data-areca-entry="${english.id}"`,
      )
      expect(nl.html).not.toContain('/nl/')
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('a Dutch text linking to a Dutch-translated entry gets the Dutch prefix', async () => {
    const { ctx, dutch } = await setup('nl-target')
    try {
      const source = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Bron',
          slug: 'bron-nl-target',
          body: body('Intro', { text: 'Read' }),
          $i18n: {
            nl: {
              title: 'Bron',
              body: body('Inleiding', {
                text: 'Lees',
                link: { entryId: dutch.id, collection: 'articles' },
              }),
            },
          },
        },
        actorId: ctx.actor.id,
      })
      await publishEntry(source.id, ctx.actor.id)
      const built = await buildSnapshot(ctx.site.id)
      if (!built.ok) throw new Error(built.errors.join('; '))
      const item = built.snapshot.collections.articles.find(
        (row) => row.id === source.id,
      )!
      const localized = localizeEntryLinks(
        item as never,
        languages,
        defaultLocalizePath('en'),
      )
      const nl = (
        localized as unknown as {
          locales: Record<string, { data: { body: { html: string } } }>
        }
      ).locales.nl.data.body
      expect(nl.html).toContain(
        `<a href="/nl/journaal/nederlands-nl-target" data-areca-entry="${dutch.id}"`,
      )
    } finally {
      await cleanupTestSite(ctx)
    }
  })
})
