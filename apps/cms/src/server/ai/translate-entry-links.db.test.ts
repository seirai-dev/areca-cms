import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '#/db'
import { entry } from '#/db/schema'

// The SDK's localize step, imported from source (see entry-link-sdk.db.test.ts).
import {
  defaultLocalizePath,
  localizeEntryLinks,
} from '../../../../../packages/site-sdk/src/entry-links.ts'
import {
  createEntry,
  publishEntry,
  updateDraft,
} from '#/server/content/entries'
import { buildSnapshot } from '#/server/content/snapshot'
import {
  articleFields,
  cleanupTestSite,
  createTestCollection,
  createTestSite,
} from '#/server/content/test-utils'

import type { AiRuntimeConfig } from './settings.ts'

const hasDb = Boolean(process.env.DATABASE_URL)
const languages = { main: 'nl', all: ['nl', 'en'] }

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  createOpenRouterText: vi.fn(),
}))

vi.mock('@tanstack/ai', () => ({ chat: mocks.chat }))
vi.mock('@tanstack/ai-openrouter', () => ({
  createOpenRouterText: mocks.createOpenRouterText,
}))

const { translateContent } = await import('./translate.ts')

const config: AiRuntimeConfig = {
  apiKey: 'or-key-test',
  model: 'vendor/text-model',
  systemPrompt: 'unused',
}

/** A rich text document with one heading and one paragraph. */
function doc(heading: string, text: string) {
  return {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: heading }],
      },
      { type: 'paragraph', content: [{ type: 'text', text }] },
    ],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe.skipIf(!hasDb)('translation keeps entry links', () => {
  it('keeps the entry, its section and its localized path in the translated language', async () => {
    const ctx = await createTestSite({ languages })
    try {
      await createTestCollection(ctx.site.id, {
        key: 'articles',
        routePattern: '/blog/$slug',
        localizedRoutes: { en: '/news/$slug' },
        fields: articleFields(),
      })
      const ethiopia = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Koffie uit Ethiopië',
          slug: 'ethiopia',
          body: doc('Herkomst', 'Tekst'),
          $i18n: {
            en: {
              title: 'Coffee from Ethiopia',
              $slug: 'coffee-ethiopia',
              body: doc('Herkomst', 'Text'),
            },
          },
        },
        actorId: ctx.actor.id,
      })
      await publishEntry(ethiopia.id, ctx.actor.id)

      const linkAttrs = {
        href: '/blog/ethiopia#herkomst',
        entryId: ethiopia.id,
        collection: 'articles',
        anchor: 'herkomst',
      }
      const sourceBody = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Lees ' },
              {
                type: 'text',
                text: 'de herkomst',
                marks: [{ type: 'link', attrs: linkAttrs }],
              },
              { type: 'text', text: ' eerst.' },
            ],
          },
        ],
      }
      const kenya = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: { title: 'Kenia', slug: 'kenia', body: sourceBody },
        actorId: ctx.actor.id,
      })

      // The model keeps the entry destination, as the prompt asks.
      mocks.chat.mockResolvedValueOnce({
        title: 'Kenya',
        body: `Read [the origin](entry:${ethiopia.id}#herkomst) first.`,
      })
      const result = await translateContent({
        config,
        sitePrompt: null,
        siteName: 'Acme',
        fromName: 'Dutch',
        toName: 'English',
        fields: articleFields(),
        source: { title: 'Kenia', body: sourceBody },
        target: {},
        seoEnabled: false,
        assets: { byId: new Map(), byStorageKey: new Map() },
      })
      expect(result.warnings).toEqual([])

      // Saved as the editor saves a translation: a draft edit of the language.
      const row = (
        await db.select().from(entry).where(eq(entry.id, kenya.id)).limit(1)
      ).at(0)!
      await updateDraft(
        kenya.id,
        {
          ...row.draftData,
          $i18n: {
            en: {
              title: result.values.title,
              body: result.values.body,
              $slug: 'kenya-en',
            },
          },
        },
        ctx.actor.id,
        row.draftVersion,
      )
      await publishEntry(kenya.id, ctx.actor.id)

      const built = await buildSnapshot(ctx.site.id)
      if (!built.ok) throw new Error(built.errors.join('; '))
      const item = built.snapshot.collections.articles.find(
        (candidate) => candidate.id === kenya.id,
      )!
      const localized = localizeEntryLinks(
        item as never,
        languages,
        defaultLocalizePath('nl'),
      )
      const en = (
        localized as unknown as {
          locales: Record<string, { data: { body: { html: string } } }>
        }
      ).locales.en.data.body
      expect(en.html).toContain(
        `<a href="/en/news/coffee-ethiopia#herkomst" data-areca-entry="${ethiopia.id}"`,
      )
    } finally {
      await cleanupTestSite(ctx)
    }
  })
})
