import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { entry, entryLink, entryRevision, publication } from '#/db/schema'
import { isEditedSinceReady } from '#/lib/content/edited-since-ready'
import { I18N_KEY } from '#/lib/content-locale'

import {
  createEntry,
  getEntry,
  publishEntry,
  scheduleEntry,
  updateDraft,
} from './entries.ts'
import { syncEntryLinkIndex, lockSiteLinkIndex } from './entry-link-index.ts'
import { ValidationError } from './errors.ts'
import { linkedFromEntry } from './linked-from.ts'
import {
  applySectionLinkUpdates,
  attachSectionLinkers,
} from './section-link-updates.ts'
import {
  cleanupTestSite,
  createSiteInOrganization,
  createTestCollection,
  createTestGlobal,
  createTestSite,
} from './test-utils.ts'
import type { SectionChange } from '#/server/richtext/section-diff'

const hasDb = Boolean(process.env.DATABASE_URL)
const EDITOR = { isOwner: false, isAgencyAdmin: false }
const OWNER = { isOwner: true, isAgencyAdmin: false }

/** A page: level-2 headings, then paragraphs (each may link to an entry). */
function page(headings: string[], paragraphs: unknown[] = []) {
  return {
    type: 'doc',
    content: [
      ...headings.map((text) => ({
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text }],
      })),
      ...paragraphs,
    ],
  }
}

/** A paragraph whose text links to an entry at a section (or the page, with null). */
function linked(
  text: string,
  entryId: string,
  anchor: string | null,
  href = '/blog/target',
) {
  return {
    type: 'paragraph',
    content: [
      {
        type: 'text',
        text,
        marks: [
          {
            type: 'link',
            attrs: { href, entryId, collection: 'articles', anchor },
          },
        ],
      },
    ],
  }
}

/** The link marks of one rich text value, in document order. */
function marksOf(
  json: unknown,
): { entryId?: string; anchor?: string | null; href?: string }[] {
  const out: { entryId?: string; anchor?: string | null; href?: string }[] = []
  const stack: unknown[] = [json]
  while (stack.length > 0) {
    const node = stack.pop() as {
      marks?: { type: string; attrs?: Record<string, unknown> }[]
      content?: unknown[]
    } | null
    if (!node || typeof node !== 'object') continue
    for (const mark of node.marks ?? []) {
      if (mark.type === 'link') {
        out.push({
          entryId: mark.attrs?.entryId as string | undefined,
          anchor: (mark.attrs?.anchor as string | null | undefined) ?? null,
          href: mark.attrs?.href as string | undefined,
        })
      }
    }
    if (Array.isArray(node.content)) stack.push(...[...node.content].reverse())
  }
  return out
}

async function setup(
  suffix: string,
  languages: { main: string; all: string[] } | null = null,
) {
  const ctx = await createTestSite({ languages })
  await createTestCollection(ctx.site.id, {
    key: 'articles',
    routePattern: '/blog/$slug',
  })
  const target = await createEntry({
    siteId: ctx.site.id,
    collectionKey: 'articles',
    data: {
      title: 'Ethiopia',
      slug: `ethiopia-${suffix}`,
      body: page(['Origin', 'Intro']),
    },
    actorId: ctx.actor.id,
  })
  return { ctx, target }
}

/** Saves the whole entry data through `updateDraft`, as an editor or an MCP call does. */
async function save(
  id: string,
  actorId: string,
  data: Record<string, unknown>,
  explicit = true,
) {
  const current = await getEntry(id)
  return updateDraft(id, data, actorId, current!.draftVersion, undefined, {
    explicit,
  })
}

async function sourceWithLink(
  ctx: { site: { id: string }; actor: { id: string } },
  title: string,
  slug: string,
  targetId: string,
  anchor: string | null,
) {
  const source = await createEntry({
    siteId: ctx.site.id,
    collectionKey: 'articles',
    data: {
      title,
      slug,
      body: page(['Intro'], [linked('Lees meer', targetId, anchor)]),
    },
    actorId: ctx.actor.id,
  })
  return source
}

describe.skipIf(!hasDb)(
  'section links: the save and the heading snapshot',
  () => {
    it('reports a renamed heading on an explicit save only, against the last explicit save', async () => {
      const { ctx, target } = await setup('snap')
      try {
        // The first explicit save records the headings: nothing has changed yet.
        const first = await save(target.id, ctx.actor.id, {
          title: 'Ethiopia',
          slug: 'ethiopia-snap',
          body: page(['Origin', 'Intro']),
        })
        expect(first.sectionChanges).toEqual([])

        // An autosave renames the heading: no report, and the baseline stays.
        const autosaved = await save(
          target.id,
          ctx.actor.id,
          {
            title: 'Ethiopia',
            slug: 'ethiopia-snap',
            body: page(['Where it grows', 'Intro']),
          },
          false,
        )
        expect(autosaved.sectionChanges).toEqual([])

        // The explicit save after it still sees the rename.
        const explicit = await save(target.id, ctx.actor.id, {
          title: 'Ethiopia',
          slug: 'ethiopia-snap',
          body: page(['Where it grows', 'Intro']),
        })
        expect(explicit.sectionChanges).toEqual([
          expect.objectContaining({
            locale: '',
            from: 'origin',
            fromText: 'Origin',
            to: 'where-it-grows',
            toText: 'Where it grows',
          }),
        ])

        // Once reported, the next explicit save reports nothing.
        const again = await save(target.id, ctx.actor.id, {
          title: 'Ethiopia',
          slug: 'ethiopia-snap',
          body: page(['Where it grows', 'Intro']),
        })
        expect(again.sectionChanges).toEqual([])
      } finally {
        await cleanupTestSite(ctx)
      }
    })

    it('names the entries that link to the changed heading, with whether this caller may update them', async () => {
      const { ctx, target } = await setup('linkers')
      try {
        const draft = await sourceWithLink(
          ctx,
          'Bron',
          'bron-linkers',
          target.id,
          'origin',
        )
        await publishEntry(draft.id, ctx.actor.id)
        const renamed = await save(target.id, ctx.actor.id, {
          title: 'Ethiopia',
          slug: 'ethiopia-linkers',
          body: page(['Where it grows', 'Intro']),
        })
        const changes = await attachSectionLinkers(
          target.id,
          renamed.sectionChanges,
          EDITOR,
        )
        expect(changes).toHaveLength(1)
        expect(changes[0].linkers).toEqual([
          expect.objectContaining({
            id: draft.id,
            title: 'Bron',
            status: 'published',
            locale: '',
            // An editor's change to an approved entry goes back to draft for an owner.
            needsApproval: true,
          }),
        ])
        const asOwner = await attachSectionLinkers(
          target.id,
          renamed.sectionChanges,
          OWNER,
        )
        expect(asOwner[0].linkers[0].needsApproval).toBe(false)
      } finally {
        await cleanupTestSite(ctx)
      }
    })
  },
)

describe.skipIf(!hasDb)('section links: "Linked from"', () => {
  it('lists the linking entries per language, with the section each link goes to', async () => {
    const { ctx, target } = await setup('linked', {
      main: 'en',
      all: ['en', 'nl'],
    })
    try {
      const withSection = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Source',
          slug: 'source-linked',
          body: page(['Intro'], [linked('Read', target.id, 'origin')]),
          [I18N_KEY]: {
            nl: {
              title: 'Bron',
              body: page(['Inleiding'], [linked('Lees', target.id, null)]),
            },
          },
        },
        actorId: ctx.actor.id,
      })
      await publishEntry(withSection.id, ctx.actor.id)
      // A translation of the target with its own heading, linked from the source.
      await save(target.id, ctx.actor.id, {
        title: 'Ethiopia',
        slug: 'ethiopia-linked',
        body: page(['Origin', 'Intro']),
        [I18N_KEY]: {
          nl: {
            title: 'Ethiopië',
            body: page(['Oorsprong']),
          },
        },
      })
      const groups = await linkedFromEntry(target.id, { isAgencyAdmin: false })
      expect(groups.map((group) => group.locale)).toEqual(['en', 'nl'])
      expect(groups[0].sources).toEqual([
        expect.objectContaining({
          id: withSection.id,
          title: 'Source',
          status: 'published',
          collectionKey: 'articles',
          sections: [{ anchor: 'origin', text: 'Origin' }],
        }),
      ])
      // The Dutch link goes to the whole page; the Dutch page has no "origin".
      expect(groups[1].sources).toEqual([
        expect.objectContaining({
          id: withSection.id,
          title: 'Bron',
          sections: [{ anchor: '', text: null }],
        }),
      ])
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('reports a section that no longer exists with no text', async () => {
    const { ctx, target } = await setup('gone')
    try {
      await sourceWithLink(ctx, 'Bron', 'bron-gone', target.id, 'origin')
      await save(target.id, ctx.actor.id, {
        title: 'Ethiopia',
        slug: 'ethiopia-gone',
        body: page(['Intro']),
      })
      const [group] = await linkedFromEntry(target.id, { isAgencyAdmin: false })
      expect(group.sources[0].sections).toEqual([
        { anchor: 'origin', text: null },
      ])
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('leaves out a switched-off section unless the viewer is an agency admin', async () => {
    const { ctx, target } = await setup('hidden')
    try {
      const global = await createTestGlobal(ctx.site.id, {
        key: 'home',
        enabled: false,
        fields: [{ key: 'intro', label: 'Intro', type: 'richtext' }],
      })
      await db
        .update(entry)
        .set({
          draftData: {
            intro: page(['Hi'], [linked('Start', target.id, null)]),
          },
        })
        .where(eq(entry.id, global.entry.id))
      await db.transaction(async (tx) => {
        await lockSiteLinkIndex(tx, ctx.site.id)
        await syncEntryLinkIndex(tx, global.entry.id)
      })
      expect(
        await linkedFromEntry(target.id, { isAgencyAdmin: false }),
      ).toEqual([])
      const asAgency = await linkedFromEntry(target.id, { isAgencyAdmin: true })
      expect(asAgency[0].sources).toEqual([
        expect.objectContaining({
          id: global.entry.id,
          kind: 'global',
          collectionKey: 'home',
        }),
      ])
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('never lists a link from another site, even one stored for this entry', async () => {
    const { ctx, target } = await setup('cross')
    try {
      const sibling = await createSiteInOrganization(ctx.org.id)
      await createTestCollection(sibling.id, {
        key: 'articles',
        routePattern: '/blog/$slug',
      })
      const elsewhere = await createEntry({
        siteId: sibling.id,
        collectionKey: 'articles',
        data: { title: 'Elders', slug: 'elders-cross', body: page(['Intro']) },
        actorId: ctx.actor.id,
      })
      // Written straight to the index, as a wrong write would leave it.
      await db.insert(entryLink).values({
        siteId: sibling.id,
        sourceEntryId: elsewhere.id,
        locale: '',
        fieldKey: 'body',
        targetEntryId: target.id,
        anchor: 'origin',
      })
      expect(await linkedFromEntry(target.id, { isAgencyAdmin: true })).toEqual(
        [],
      )
    } finally {
      await cleanupTestSite(ctx)
    }
  })
})

describe.skipIf(!hasDb)('section links: the bulk update', () => {
  /** Target renamed from Origin; a draft source and an approved source link to it. */
  async function renamedWithLinks(suffix: string) {
    const { ctx, target } = await setup(suffix)
    const draftSource = await sourceWithLink(
      ctx,
      'Concept',
      `concept-${suffix}`,
      target.id,
      'origin',
    )
    const readySource = await sourceWithLink(
      ctx,
      'Klaar',
      `klaar-${suffix}`,
      target.id,
      'origin',
    )
    await publishEntry(readySource.id, ctx.actor.id)
    const renamed = await save(target.id, ctx.actor.id, {
      title: 'Ethiopia',
      slug: `ethiopia-${suffix}`,
      body: page(['Where it grows', 'Intro']),
    })
    const change: SectionChange = renamed.sectionChanges[0]
    expect(change.to).toBe('where-it-grows')
    return { ctx, target, draftSource, readySource, change }
  }

  it('updates the draft of a ready entry for an editor, leaves the approved version alone, and asks for approval again', async () => {
    const { ctx, target, draftSource, readySource } =
      await renamedWithLinks('editor')
    try {
      const before = await getEntry(readySource.id)
      expect(isEditedSinceReady(before!)).toBe(false)
      const result = await applySectionLinkUpdates({
        targetId: target.id,
        actorId: ctx.actor.id,
        viewer: EDITOR,
        updates: [{ locale: '', from: 'origin', to: 'where-it-grows' }],
      })
      expect(result.updated.map((row) => row.id).sort()).toEqual(
        [draftSource.id, readySource.id].sort(),
      )

      const draft = await getEntry(draftSource.id)
      expect(marksOf(draft!.draftData.body)).toEqual([
        expect.objectContaining({
          entryId: target.id,
          anchor: 'where-it-grows',
          href: '/blog/ethiopia-editor#where-it-grows',
        }),
      ])
      // The new link is in the draft only: the approved version (what goes
      // live) keeps the old link, and the entry reads as edited since ready
      // until an owner approves it.
      const after = await getEntry(readySource.id)
      expect(after!.publishedData).toEqual(before!.publishedData)
      expect(after!.publishedAt?.toISOString()).toBe(
        before!.publishedAt?.toISOString(),
      )
      expect(after!.status).toBe('published')
      expect(marksOf(after!.draftData.body)[0].anchor).toBe('where-it-grows')
      expect(isEditedSinceReady(after!)).toBe(true)
      expect(after!.draftVersion).toBeGreaterThan(before!.draftVersion)
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('updates the draft of a scheduled entry for an editor and leaves the schedule alone', async () => {
    const { ctx, target } = await renamedWithLinks('editor-scheduled')
    try {
      const scheduled = await sourceWithLink(
        ctx,
        'Gepland',
        'gepland-editor-scheduled',
        target.id,
        'origin',
      )
      await publishEntry(scheduled.id, ctx.actor.id)
      await scheduleEntry(
        scheduled.id,
        new Date(Date.now() + 3 * 86_400_000).toISOString(),
        'UTC',
        ctx.actor.id,
      )
      const before = await getEntry(scheduled.id)
      await applySectionLinkUpdates({
        targetId: target.id,
        actorId: ctx.actor.id,
        viewer: EDITOR,
        updates: [{ locale: '', from: 'origin', to: 'where-it-grows' }],
      })
      const after = await getEntry(scheduled.id)
      expect(after!.status).toBe('scheduled')
      expect(after!.scheduledVersion).toBe(before!.scheduledVersion)
      expect(after!.scheduledAt?.toISOString()).toBe(
        before!.scheduledAt?.toISOString(),
      )
      expect(marksOf(after!.scheduledData!.body)[0].anchor).toBe('origin')
      expect(marksOf(after!.draftData.body)[0].anchor).toBe('where-it-grows')
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('updates an approved version for an owner, keeping status, approval time and the edited-since-ready state', async () => {
    const { ctx, target, readySource } = await renamedWithLinks('owner')
    try {
      const before = await getEntry(readySource.id)
      expect(isEditedSinceReady(before!)).toBe(false)
      const result = await applySectionLinkUpdates({
        targetId: target.id,
        actorId: ctx.actor.id,
        viewer: OWNER,
        updates: [{ locale: '', from: 'origin', to: 'where-it-grows' }],
      })
      expect(result.updated.map((row) => row.id)).toContain(readySource.id)

      const after = await getEntry(readySource.id)
      expect(after!.status).toBe('published')
      expect(after!.publishedAt?.toISOString()).toBe(
        before!.publishedAt?.toISOString(),
      )
      expect(marksOf(after!.publishedData!.body)).toEqual([
        expect.objectContaining({
          anchor: 'where-it-grows',
          href: '/blog/ethiopia-owner#where-it-grows',
        }),
      ])
      expect(marksOf(after!.draftData.body)[0].anchor).toBe('where-it-grows')
      // Both copies moved together, so nothing reads as edited.
      expect(isEditedSinceReady(after!)).toBe(false)
      expect(after!.draftVersion).toBeGreaterThan(before!.draftVersion)
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('updates a scheduled version and keeps its scheduled version id', async () => {
    const { ctx, target } = await renamedWithLinks('scheduled')
    try {
      const scheduled = await sourceWithLink(
        ctx,
        'Gepland',
        'gepland-scheduled',
        target.id,
        'origin',
      )
      await publishEntry(scheduled.id, ctx.actor.id)
      await scheduleEntry(
        scheduled.id,
        new Date(Date.now() + 3 * 86_400_000).toISOString(),
        'UTC',
        ctx.actor.id,
      )
      const before = await getEntry(scheduled.id)
      expect(before!.status).toBe('scheduled')
      await applySectionLinkUpdates({
        targetId: target.id,
        actorId: ctx.actor.id,
        viewer: OWNER,
        updates: [{ locale: '', from: 'origin', to: 'where-it-grows' }],
      })
      const after = await getEntry(scheduled.id)
      expect(after!.status).toBe('scheduled')
      expect(after!.scheduledVersion).toBe(before!.scheduledVersion)
      expect(after!.scheduledAt?.toISOString()).toBe(
        before!.scheduledAt?.toISOString(),
      )
      expect(marksOf(after!.scheduledData!.body)[0].anchor).toBe(
        'where-it-grows',
      )
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('moves the index rows, records a revision, and changes no publication', async () => {
    const { ctx, target, draftSource, readySource } =
      await renamedWithLinks('rows')
    try {
      const publicationsBefore = await db
        .select({ id: publication.id })
        .from(publication)
        .where(eq(publication.siteId, ctx.site.id))
      await applySectionLinkUpdates({
        targetId: target.id,
        actorId: ctx.actor.id,
        viewer: OWNER,
        updates: [{ locale: '', from: 'origin', to: 'where-it-grows' }],
      })
      const rows = await db
        .select({ source: entryLink.sourceEntryId, anchor: entryLink.anchor })
        .from(entryLink)
        .where(eq(entryLink.targetEntryId, target.id))
      expect(rows.sort((a, b) => a.source.localeCompare(b.source))).toEqual(
        [draftSource.id, readySource.id]
          .sort((a, b) => a.localeCompare(b))
          .map((source) => ({ source, anchor: 'where-it-grows' })),
      )
      const revisions = await db
        .select({ createdBy: entryRevision.createdBy })
        .from(entryRevision)
        .where(
          and(
            eq(entryRevision.entryId, draftSource.id),
            eq(entryRevision.note, 'section-links'),
          ),
        )
      expect(revisions).toEqual([{ createdBy: ctx.actor.id }])
      const publicationsAfter = await db
        .select({ id: publication.id })
        .from(publication)
        .where(eq(publication.siteId, ctx.site.id))
      expect(publicationsAfter).toEqual(publicationsBefore)
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('removes a link to the section when the new section is the page', async () => {
    const { ctx, target, draftSource } = await renamedWithLinks('page')
    try {
      await applySectionLinkUpdates({
        targetId: target.id,
        actorId: ctx.actor.id,
        viewer: OWNER,
        updates: [{ locale: '', from: 'origin', to: '' }],
      })
      const draft = await getEntry(draftSource.id)
      expect(marksOf(draft!.draftData.body)).toEqual([
        expect.objectContaining({
          entryId: target.id,
          anchor: null,
          href: '/blog/ethiopia-page',
        }),
      ])
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('refuses a section the target does not have', async () => {
    const { ctx, target } = await renamedWithLinks('invalid')
    try {
      await expect(
        applySectionLinkUpdates({
          targetId: target.id,
          actorId: ctx.actor.id,
          viewer: OWNER,
          updates: [{ locale: '', from: 'origin', to: 'nowhere' }],
        }),
      ).rejects.toBeInstanceOf(ValidationError)
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('runs next to saves of the same entries without a deadlock', async () => {
    const { ctx, target, draftSource, readySource } =
      await renamedWithLinks('locks')
    try {
      for (let round = 0; round < 3; round += 1) {
        const results = await Promise.allSettled([
          applySectionLinkUpdates({
            targetId: target.id,
            actorId: ctx.actor.id,
            viewer: OWNER,
            updates: [{ locale: '', from: 'origin', to: 'where-it-grows' }],
          }),
          save(draftSource.id, ctx.actor.id, {
            title: 'Concept',
            slug: `concept-locks`,
            body: page(
              ['Intro'],
              [linked('Lees meer', target.id, 'where-it-grows')],
            ),
          }),
          save(readySource.id, ctx.actor.id, {
            title: 'Klaar',
            slug: `klaar-locks`,
            body: page(
              ['Intro'],
              [linked('Lees meer', target.id, 'where-it-grows')],
            ),
          }),
        ])
        for (const result of results) {
          if (result.status === 'rejected') {
            expect(String(result.reason)).not.toMatch(/40P01|deadlock/i)
          }
        }
      }
    } finally {
      await cleanupTestSite(ctx)
    }
  })
})
