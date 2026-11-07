import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { entryLink } from '#/db/schema'

import {
  archiveEntry,
  createEntry,
  deleteEntry,
  publishEntry,
  updateDraft,
} from './entries.ts'
import { ValidationError } from './errors.ts'
import { listInboundReferences } from './inbound-references.ts'
import { rebuildEntryLinkIndex } from './entry-link-index.ts'
import { buildPreviewEntry, buildSnapshot } from './snapshot.ts'
import type { LinkWarning } from './snapshot.ts'
import {
  cleanupTestSite,
  createTestCollection,
  createTestGlobal,
  createTestSite,
} from './test-utils.ts'

const hasDb = Boolean(process.env.DATABASE_URL)
const languages = { main: 'nl', all: ['nl', 'en'] }

/** A body with a heading (for sections) and one paragraph, optionally with a link on its text. */
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

type Built = Awaited<ReturnType<typeof buildSnapshot>>
function expectOk(built: Built) {
  if (!built.ok) throw new Error(`snapshot failed: ${built.errors.join('; ')}`)
  return built
}

/** A site with languages, an articles collection (nl main, en route `/news`) and a published target. */
async function setup(suffix: string) {
  const ctx = await createTestSite({ languages })
  await createTestCollection(ctx.site.id, {
    key: 'articles',
    routePattern: '/blog/$slug',
    localizedRoutes: { en: '/news/$slug' },
  })
  // Main language slug `vragen`; English slug `questions` with its own sections.
  const target = await createEntry({
    siteId: ctx.site.id,
    collectionKey: 'articles',
    data: {
      title: 'Vragen',
      slug: `vragen-${suffix}`,
      body: body('Veelgestelde vragen', { text: 'Stel je vraag' }),
      $i18n: {
        en: {
          title: 'Questions',
          $slug: `questions-${suffix}`,
          body: body('Frequently asked questions', { text: 'Ask' }),
        },
      },
    },
    actorId: ctx.actor.id,
  })
  await publishEntry(target.id, ctx.actor.id)
  return { ctx, target }
}

describe.skipIf(!hasDb)('entry links: save check', () => {
  it('rejects a link to an entry of another site', async () => {
    const { ctx, target } = await setup('save-other')
    const other = await createTestSite()
    try {
      await createTestCollection(other.site.id, {
        key: 'articles',
        routePattern: '/blog/$slug',
      })
      const foreign = await createEntry({
        siteId: other.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Ander',
          slug: 'ander',
          body: body('Kop', { text: 'x' }),
        },
        actorId: other.actor.id,
      })
      await expect(
        createEntry({
          siteId: ctx.site.id,
          collectionKey: 'articles',
          data: {
            title: 'Bron',
            slug: 'bron-save-other',
            body: body('Inleiding', {
              text: 'Lees',
              link: { entryId: foreign.id, collection: 'articles' },
            }),
          },
          actorId: ctx.actor.id,
        }),
      ).rejects.toThrow(ValidationError)
      expect(target.id).toBeTruthy()
    } finally {
      await cleanupTestSite(other)
      await cleanupTestSite(ctx)
    }
  })

  it('rejects a link to a site content section and to an unknown id', async () => {
    const { ctx } = await setup('save-section')
    try {
      const section = await createTestGlobal(ctx.site.id, {
        key: 'companyInfo',
      })
      for (const entryId of [
        section.entry.id,
        '00000000-0000-4000-8000-000000000000',
      ]) {
        await expect(
          createEntry({
            siteId: ctx.site.id,
            collectionKey: 'articles',
            data: {
              title: 'Bron',
              slug: `bron-${entryId.slice(0, 6)}`,
              body: body('Inleiding', {
                text: 'Lees',
                link: { entryId, collection: 'articles' },
              }),
            },
            actorId: ctx.actor.id,
          }),
        ).rejects.toThrow(ValidationError)
      }
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('recomputes the stored collection and href from the target', async () => {
    const { ctx, target } = await setup('save-href')
    try {
      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Bron',
          slug: 'bron-save-href',
          body: body('Inleiding', {
            text: 'Lees',
            link: {
              href: '/wrong/place',
              entryId: target.id,
              collection: 'wrong',
              anchor: 'x',
            },
          }),
        },
        actorId: ctx.actor.id,
      })
      const stored = created.draftData.body as {
        content: {
          content: { marks: { attrs: Record<string, unknown> }[] }[]
        }[]
      }
      const attrs = stored.content[1].content[0].marks[0].attrs
      expect(attrs).toMatchObject({
        href: `/blog/vragen-save-href#x`,
        entryId: target.id,
        collection: 'articles',
        anchor: 'x',
      })
    } finally {
      await cleanupTestSite(ctx)
    }
  })
})

describe.skipIf(!hasDb)('entry links: snapshot resolution', () => {
  it('resolves each language to its own route and slug, keeps sections, and warns about a missing one', async () => {
    const { ctx, target } = await setup('snap-main')
    try {
      const source = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Bron',
          slug: 'bron-snap-main',
          body: body('Inleiding', {
            text: 'Zie de vragen',
            link: {
              entryId: target.id,
              collection: 'articles',
              anchor: 'veelgestelde-vragen',
            },
          }),
          $i18n: {
            en: {
              title: 'Source',
              body: body('Intro', {
                text: 'See the questions',
                link: {
                  entryId: target.id,
                  collection: 'articles',
                  anchor: 'veelgestelde-vragen',
                },
              }),
            },
          },
        },
        actorId: ctx.actor.id,
      })
      await publishEntry(source.id, ctx.actor.id)

      const built = expectOk(await buildSnapshot(ctx.site.id))
      const item = built.snapshot.collections.articles.find(
        (row) => row.id === source.id,
      )!

      // Dutch: the main route and slug, with the section (it exists in Dutch).
      const nl = item.data.body as {
        html: string
        markdown: string
        json: unknown
      }
      expect(nl.html).toContain(
        `<a href="/blog/vragen-snap-main#veelgestelde-vragen" data-areca-entry="${target.id}" data-areca-locale="nl">`,
      )
      expect(nl.markdown).toContain(
        '[areca-entry-1]: /blog/vragen-snap-main#veelgestelde-vragen',
      )
      expect(JSON.stringify(nl.json)).toContain(
        '"href":"/blog/vragen-snap-main#veelgestelde-vragen"',
      )

      // English: the English route and slug. The section is not in English, so the link goes to the page.
      const en = item.locales!.en.data.body as { html: string }
      expect(en.html).toContain(
        `<a href="/news/questions-snap-main" data-areca-entry="${target.id}" data-areca-locale="en">`,
      )

      const mine: LinkWarning[] = built.linkWarnings.filter(
        (warning) => warning.sourceEntryId === source.id,
      )
      expect(mine).toEqual([
        {
          sourceEntryId: source.id,
          sourceTitle: 'Source',
          sourceCollectionKey: 'articles',
          sourceGlobal: false,
          locale: 'en',
          field: 'body',
          targetEntryId: target.id,
          targetTitle: 'Questions',
          anchor: 'veelgestelde-vragen',
          reason: 'missing-section',
        },
      ])
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('falls back to the main language when the target has no translation in that language', async () => {
    const { ctx } = await setup('snap-fallback')
    try {
      const plain = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Alleen nl',
          slug: 'alleen-nl',
          body: body('Kop', { text: 'Tekst' }),
        },
        actorId: ctx.actor.id,
      })
      await publishEntry(plain.id, ctx.actor.id)
      const source = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Bron',
          slug: 'bron-snap-fallback',
          body: body('Inleiding', { text: 'x' }),
          $i18n: {
            en: {
              title: 'Source',
              body: body('Intro', {
                text: 'Read',
                link: { entryId: plain.id, collection: 'articles' },
              }),
            },
          },
        },
        actorId: ctx.actor.id,
      })
      await publishEntry(source.id, ctx.actor.id)

      const built = expectOk(await buildSnapshot(ctx.site.id))
      const item = built.snapshot.collections.articles.find(
        (row) => row.id === source.id,
      )!
      const en = item.locales!.en.data.body as { html: string }
      expect(en.html).toContain(
        `href="/blog/alleen-nl" data-areca-entry="${plain.id}"`,
      )
      expect(
        built.linkWarnings.filter((w) => w.sourceEntryId === source.id),
      ).toEqual([])
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('publishes a link to a draft as plain text, warns, and never blocks the release', async () => {
    const { ctx } = await setup('snap-draft')
    try {
      const draft = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Concept',
          slug: 'concept-snap',
          body: body('Kop', { text: 'Tekst' }),
        },
        actorId: ctx.actor.id,
      })
      const source = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Bron',
          slug: 'bron-snap-draft',
          body: body('Inleiding', {
            text: 'Lees het concept',
            link: { entryId: draft.id, collection: 'articles' },
          }),
        },
        actorId: ctx.actor.id,
      })
      await publishEntry(source.id, ctx.actor.id)

      const built = expectOk(await buildSnapshot(ctx.site.id))
      const item = built.snapshot.collections.articles.find(
        (row) => row.id === source.id,
      )!
      const nl = item.data.body as { html: string; markdown: string }
      expect(nl.html).toContain('Lees het concept')
      expect(nl.html).not.toContain(draft.id)
      expect(nl.markdown).not.toContain('areca-entry')
      expect(built.linkWarnings).toContainEqual(
        expect.objectContaining({
          sourceEntryId: source.id,
          targetEntryId: draft.id,
          targetTitle: 'Concept',
          reason: 'not-live',
          locale: 'nl',
        }),
      )
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('treats a link to a deleted entry as missing', async () => {
    const { ctx } = await setup('snap-deleted')
    try {
      const gone = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Weg',
          slug: 'weg-snap',
          body: body('Kop', { text: 'x' }),
        },
        actorId: ctx.actor.id,
      })
      await publishEntry(gone.id, ctx.actor.id)
      const source = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Bron',
          slug: 'bron-snap-deleted',
          body: body('Inleiding', {
            text: 'Lees',
            link: { entryId: gone.id, collection: 'articles' },
          }),
        },
        actorId: ctx.actor.id,
      })
      await publishEntry(source.id, ctx.actor.id)
      await deleteEntry(gone.id, ctx.actor.id)

      const built = expectOk(await buildSnapshot(ctx.site.id))
      expect(built.linkWarnings).toContainEqual(
        expect.objectContaining({
          sourceEntryId: source.id,
          targetEntryId: gone.id,
          reason: 'missing',
        }),
      )
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('points a draft preview at the draft path, live or not', async () => {
    const { ctx } = await setup('preview')
    try {
      const draft = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Concept',
          slug: 'concept-preview',
          body: body('Kop', { text: 'x' }),
        },
        actorId: ctx.actor.id,
      })
      const source = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Bron',
          slug: 'bron-preview',
          body: body('Inleiding', {
            text: 'Lees',
            link: { entryId: draft.id, collection: 'articles', anchor: 'kop' },
          }),
        },
        actorId: ctx.actor.id,
      })
      const preview = await buildPreviewEntry(
        ctx.site.id,
        'articles',
        'bron-preview',
        'nl',
      )
      expect(preview).not.toBeNull()
      expect(source.id).toBeTruthy()
      const html = (preview!.data.body as { html: string }).html
      expect(html).toContain(
        `href="/blog/concept-preview#kop" data-areca-entry="${draft.id}"`,
      )
    } finally {
      await cleanupTestSite(ctx)
    }
  })
})

describe.skipIf(!hasDb)('entry links: link index and delete warning', () => {
  it('follows content writes and lists the linking entry on delete', async () => {
    const { ctx, target } = await setup('index')
    try {
      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Bron',
          slug: 'bron-index',
          body: body('Inleiding', {
            text: 'Lees',
            link: {
              entryId: target.id,
              collection: 'articles',
              anchor: 'veelgestelde-vragen',
            },
          }),
        },
        actorId: ctx.actor.id,
      })
      const rows = await db
        .select()
        .from(entryLink)
        .where(eq(entryLink.sourceEntryId, created.id))
      expect(rows).toEqual([
        expect.objectContaining({
          siteId: ctx.site.id,
          locale: 'nl',
          fieldKey: 'body',
          targetEntryId: target.id,
          anchor: 'veelgestelde-vragen',
        }),
      ])

      const inbound = await listInboundReferences(target.id, true)
      expect(inbound.map((row) => row.id)).toContain(created.id)

      // Removing the link removes the row.
      await updateDraft(
        created.id,
        {
          title: 'Bron',
          slug: 'bron-index',
          body: body('Inleiding', { text: 'Geen link' }),
        },
        ctx.actor.id,
        created.draftVersion,
      )
      expect(
        await db
          .select()
          .from(entryLink)
          .where(eq(entryLink.sourceEntryId, created.id)),
      ).toEqual([])
      expect(
        (await listInboundReferences(target.id, true)).map((row) => row.id),
      ).not.toContain(created.id)

      // Archiving keeps the rows: the entry and its content still exist.
      const archived = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Bron archief',
          slug: 'bron-index-archief',
          body: body('Inleiding', {
            text: 'Lees',
            link: { entryId: target.id, collection: 'articles' },
          }),
        },
        actorId: ctx.actor.id,
      })
      await archiveEntry(archived.id, ctx.actor.id)
      expect(
        await db
          .select()
          .from(entryLink)
          .where(eq(entryLink.sourceEntryId, archived.id)),
      ).toHaveLength(1)

      // Adding it again, then deleting the target drops the rows through the foreign key.
      const again = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Bron twee',
          slug: 'bron-index-twee',
          body: body('Inleiding', {
            text: 'Lees',
            link: { entryId: target.id, collection: 'articles' },
          }),
        },
        actorId: ctx.actor.id,
      })
      expect(
        await db
          .select()
          .from(entryLink)
          .where(eq(entryLink.sourceEntryId, again.id)),
      ).toHaveLength(1)
      await deleteEntry(target.id, ctx.actor.id)
      expect(
        await db
          .select()
          .from(entryLink)
          .where(eq(entryLink.targetEntryId, target.id)),
      ).toEqual([])
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('rebuilds the index of a site from its content', async () => {
    const { ctx, target } = await setup('rebuild')
    try {
      const source = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Bron',
          slug: 'bron-rebuild',
          body: body('Inleiding', {
            text: 'Lees',
            link: { entryId: target.id, collection: 'articles' },
          }),
        },
        actorId: ctx.actor.id,
      })
      await db.delete(entryLink).where(eq(entryLink.siteId, ctx.site.id))
      const written = await db.transaction((tx) =>
        rebuildEntryLinkIndex(tx, ctx.site.id),
      )
      expect(written).toBe(1)
      const rows = await db
        .select()
        .from(entryLink)
        .where(eq(entryLink.sourceEntryId, source.id))
      expect(rows).toHaveLength(1)
    } finally {
      await cleanupTestSite(ctx)
    }
  })
})
