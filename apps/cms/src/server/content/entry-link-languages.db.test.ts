import { describe, expect, it } from 'vitest'

import { createEntry, publishEntry } from './entries.ts'
import { buildSnapshot } from './snapshot.ts'
import { buildPreviewEntry } from './snapshot-preview.ts'
import {
  cleanupTestSite,
  createTestCollection,
  createTestSite,
} from './test-utils.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

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
 * English is the main language and has the `/journal` route; Dutch has its
 * own route `/journaal`. `example` is English only: it has no Dutch text.
 */
async function setupEnglishMain(suffix: string) {
  const ctx = await createTestSite({
    languages: { main: 'en', all: ['en', 'nl'] },
  })
  await createTestCollection(ctx.site.id, {
    key: 'articles',
    routePattern: '/journal/$slug',
    localizedRoutes: { nl: '/journaal/$slug' },
  })
  const example = await createEntry({
    siteId: ctx.site.id,
    collectionKey: 'articles',
    data: {
      title: 'Example',
      slug: `example-${suffix}`,
      body: body('Heading', { text: 'Read' }),
    },
    actorId: ctx.actor.id,
  })
  await publishEntry(example.id, ctx.actor.id)
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
            link: { entryId: example.id, collection: 'articles' },
          }),
        },
      },
    },
    actorId: ctx.actor.id,
  })
  await publishEntry(source.id, ctx.actor.id)
  return { ctx, example, source }
}

describe.skipIf(!hasDb)(
  'entry links: the language a target is placed in',
  () => {
    it('points a Dutch preview at the main-language path of an English-only target', async () => {
      const { ctx, example, source } = await setupEnglishMain('preview')
      try {
        const preview = await buildPreviewEntry(
          ctx.site.id,
          'articles',
          `source-preview`,
          'nl',
        )
        expect(preview).not.toBeNull()
        const html = (preview!.data.body as { html: string }).html
        expect(html).toContain(
          `href="/journal/example-preview" data-areca-entry="${example.id}"`,
        )
        expect(html).not.toContain('/journaal/')
        expect(source.id).toBeTruthy()
      } finally {
        await cleanupTestSite(ctx)
      }
    })

    it('gives the release and the draft preview the same path for the same link', async () => {
      const { ctx, example } = await setupEnglishMain('agree')
      try {
        const built = await buildSnapshot(ctx.site.id)
        if (!built.ok) throw new Error(built.errors.join('; '))
        const source = built.snapshot.collections.articles.find(
          (row) => row.slug === 'source-agree',
        )!
        const released = (source.locales!.nl.data.body as { html: string }).html
        const preview = await buildPreviewEntry(
          ctx.site.id,
          'articles',
          'source-agree',
          'nl',
        )
        const previewed = (preview!.data.body as { html: string }).html
        expect(released).toContain(
          `href="/journal/example-agree" data-areca-entry="${example.id}"`,
        )
        expect(previewed).toContain(
          `href="/journal/example-agree" data-areca-entry="${example.id}"`,
        )
      } finally {
        await cleanupTestSite(ctx)
      }
    })
  },
)
