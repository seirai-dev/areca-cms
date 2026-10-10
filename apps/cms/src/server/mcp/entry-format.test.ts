import { describe, expect, it } from 'vitest'

import type { Field } from '#/lib/types'
import { ValidationError } from '#/server/content/errors'

import type { AssetLookup } from './entry-format'
import {
  agentStatus,
  collectAssetIds,
  formatEntry,
  formatSnapshotFields,
  linkAssetRefs,
  markdownAssetIds,
  mergeSeo,
  seoPatchFromInput,
  storedStatus,
  summarizeEntry,
  toStoredFields,
} from './entry-format'
import { releaseFlags } from './release-flags'

const NOT_LIVE = { live: false, pendingRelease: false }
const LIVE_AND_PENDING = { live: true, pendingRelease: true }

const fields: Field[] = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'slug', label: 'Slug', type: 'slug', required: true },
  { key: 'body', label: 'Body', type: 'richtext', required: true },
  { key: 'heroImage', label: 'Hero', type: 'image' },
  { key: 'related', label: 'Related', type: 'reference', collection: 'pages' },
  {
    key: 'category',
    label: 'Category',
    type: 'select',
    options: ['news', 'updates'],
  },
]

const ASSET_ID = '11111111-2222-4333-8444-555555555555'
const STORAGE_KEY = 'org-1/abc.png'

function lookup(): AssetLookup {
  const row = {
    id: ASSET_ID,
    storageKey: STORAGE_KEY,
    altText: 'A loaf',
  }
  return {
    byId: new Map([[ASSET_ID, row]]),
    byStorageKey: new Map([[STORAGE_KEY, row]]),
  }
}

const empty: AssetLookup = { byId: new Map(), byStorageKey: new Map() }

describe('toStoredFields', () => {
  it('converts Markdown rich text to a TipTap document', () => {
    const data = toStoredFields(
      fields,
      { title: 'Hi', body: '## Heading\n\nSome **bold** text.' },
      empty,
    )
    expect(data.title).toBe('Hi')
    const body = data.body as { type: string; content: { type: string }[] }
    expect(body.type).toBe('doc')
    expect(body.content[0]?.type).toBe('heading')
  })

  it('resolves asset references in Markdown images to the stored file path', () => {
    const data = toStoredFields(
      fields,
      { body: `Intro.\n\n![A loaf](asset:${ASSET_ID})` },
      lookup(),
    )
    expect(JSON.stringify(data.body)).toContain(
      `/api/assets/file/${STORAGE_KEY}`,
    )
  })

  it('rejects an unknown field and lists the valid ones', () => {
    expect(() => toStoredFields(fields, { titel: 'typo' }, empty)).toThrow(
      ValidationError,
    )
    try {
      toStoredFields(fields, { titel: 'typo' }, empty)
    } catch (error) {
      expect((error as ValidationError).message).toContain(
        'fields.titel: unknown field. Valid fields: title, slug, body, heroImage, related, category',
      )
    }
  })

  it('tells the agent to use seo instead of $seo inside fields', () => {
    try {
      toStoredFields(fields, { $seo: {} }, empty)
      throw new Error('expected a ValidationError')
    } catch (error) {
      expect((error as ValidationError).message).toContain('use the seo object')
    }
  })

  it('reports a Markdown image whose asset is not in the organization', () => {
    expect(() =>
      toStoredFields(fields, { body: '![x](asset:not-mine)' }, empty),
    ).toThrow(/asset not-mine was not found in this organization/)
  })

  it('accepts the {assetId} and {entryId} shorthands', () => {
    const data = toStoredFields(
      fields,
      { heroImage: { assetId: ASSET_ID }, related: { entryId: 'entry-9' } },
      lookup(),
    )
    expect(data.heroImage).toBe(ASSET_ID)
    expect(data.related).toBe('entry-9')
  })

  it('keeps null as a clearing value', () => {
    expect(toStoredFields(fields, { heroImage: null }, empty)).toEqual({
      heroImage: null,
    })
  })
})

describe('asset references', () => {
  it('finds Markdown image ids and ids in image fields and seo', () => {
    const md = `![a](asset:one) text ![b](asset:two)`
    expect(markdownAssetIds(md)).toEqual(['one', 'two'])
    expect(
      collectAssetIds(
        fields,
        { heroImage: 'three', body: md },
        { ogImage: 'four' },
      ).sort(),
    ).toEqual(['four', 'one', 'three', 'two'])
  })

  it('collects titled and reference images but ignores code examples', () => {
    const md = `![Titled](asset:${ASSET_ID} "Title")\n\n![Reference][img]\n\n[img]: asset:${ASSET_ID}`
    expect(markdownAssetIds(md)).toEqual([ASSET_ID])
    expect(
      JSON.stringify(toStoredFields(fields, { body: md }, lookup()).body),
    ).toContain(STORAGE_KEY)
    const code = '```md\n![example](asset:missing)\n```'
    expect(markdownAssetIds(code)).toEqual([])
    expect(() => toStoredFields(fields, { body: code }, empty)).not.toThrow()
    expect(() =>
      toStoredFields(fields, { body: '![x](asset:missing "title")' }, empty),
    ).toThrow(ValidationError)
  })

  it('preserves ordinary download links when resolving image references', () => {
    const link = `[Download](/api/assets/file/${STORAGE_KEY})`
    expect(linkAssetRefs(link, lookup())).toBe(link)
  })

  it('rewrites stored image links back to asset references', () => {
    const md = `Look ![cap](/api/assets/file/${STORAGE_KEY}) and ![x](https://example.com/a.png)`
    expect(linkAssetRefs(md, lookup())).toBe(
      `Look ![cap](asset:${ASSET_ID}) and ![x](https://example.com/a.png)`,
    )
  })
})

describe('mergeSeo', () => {
  it('merges a patch and removes keys set to null', () => {
    expect(
      mergeSeo(
        { title: 'Old', description: 'Keep me' },
        { title: 'New', description: null },
      ),
    ).toEqual({ title: 'New' })
  })

  it('returns undefined when nothing is left, so no empty $seo is stored', () => {
    expect(mergeSeo({ title: 'Old' }, { title: null })).toBeUndefined()
    expect(mergeSeo(undefined, undefined)).toBeUndefined()
  })
})

describe('status vocabulary', () => {
  it('reads the stored published state as ready, and passes the others through', () => {
    expect(agentStatus('published')).toBe('ready')
    expect(agentStatus('draft')).toBe('draft')
    expect(agentStatus('scheduled')).toBe('scheduled')
    expect(agentStatus('archived')).toBe('archived')
  })

  it('maps the ready filter back to the stored state', () => {
    expect(storedStatus('ready')).toBe('published')
    expect(storedStatus('draft')).toBe('draft')
  })
})

describe('releaseFlags', () => {
  const state = {
    liveIds: new Set(['live-only', 'live-and-pending']),
    pendingIds: new Set(['live-and-pending', 'pending-only']),
  }

  it('reports live and pending independently', () => {
    expect(releaseFlags(state, 'live-only')).toEqual({
      live: true,
      pendingRelease: false,
    })
    expect(releaseFlags(state, 'live-and-pending')).toEqual(LIVE_AND_PENDING)
    expect(releaseFlags(state, 'pending-only')).toEqual({
      live: false,
      pendingRelease: true,
    })
    expect(releaseFlags(state, 'unknown')).toEqual(NOT_LIVE)
  })
})

describe('formatEntry', () => {
  const now = new Date('2026-10-10T08:00:00.000Z')
  const entry = {
    id: 'entry-1',
    slug: 'hello',
    status: 'published' as const,
    draftVersion: 3,
    draftData: {
      title: 'Hello',
      body: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Body' }] },
        ],
      },
      heroImage: ASSET_ID,
      related: 'entry-9',
      $seo: { title: 'Hello SEO' },
    } as Record<string, unknown>,
    publishedData: { title: 'Hello', $seo: { title: 'Hello SEO' } } as Record<
      string,
      unknown
    >,
    publishedAt: now,
    scheduledAt: null,
    scheduleTimezone: null,
    updatedAt: now,
    collectionKey: 'posts',
  }
  const ctx = (assets: AssetLookup = lookup()) => ({
    assets,
    assetUrl: (key: string) => `https://cms.test/api/assets/file/${key}`,
  })

  it('formats fields for agents with the ready vocabulary', () => {
    const out = formatEntry({
      entry,
      fields,
      ctx: ctx(),
      release: LIVE_AND_PENDING,
      previewAvailable: true,
      includePublished: false,
    })
    expect(out.version).toBe(3)
    expect(out.collection).toBe('posts')
    expect(out.status).toBe('ready')
    expect(out.live).toBe(true)
    expect(out.pendingRelease).toBe(true)
    expect(out.approvedAt).toBe(now.toISOString())
    expect(out.editedSinceReady).toBe(true)
    expect(out.fields.body).toBe('Body')
    expect(out.fields.heroImage).toEqual({
      assetId: ASSET_ID,
      url: `https://cms.test/api/assets/file/${STORAGE_KEY}`,
      alt: 'A loaf',
    })
    expect(out.fields.related).toEqual({ entryId: 'entry-9' })
    expect(out.seo).toEqual({ title: 'Hello SEO' })
    expect('publishedAt' in out).toBe(false)
    expect('hasUnpublishedChanges' in out).toBe(false)
    expect('liveFields' in out).toBe(false)
  })

  it('reports a ready entry that is not on the live site yet', () => {
    const out = formatEntry({
      entry,
      fields,
      ctx: ctx(),
      release: NOT_LIVE,
      previewAvailable: true,
      includePublished: false,
    })
    expect(out.status).toBe('ready')
    expect(out.live).toBe(false)
    expect(out.pendingRelease).toBe(false)
  })

  it('adds liveFields only when asked', () => {
    const out = formatEntry({
      entry,
      fields,
      ctx: ctx(empty),
      release: NOT_LIVE,
      previewAvailable: false,
      includePublished: true,
    })
    expect(out.liveFields).toBeNull()
    expect(out.approvedFields).toEqual({ title: 'Hello' })
    expect(out.previewAvailable).toBe(false)
  })

  it('reports SEO-only changes and ignores object property order', () => {
    const options = {
      entry,
      fields,
      ctx: ctx(),
      release: LIVE_AND_PENDING,
      previewAvailable: true,
      includePublished: false,
    }
    expect(
      formatEntry({
        ...options,
        entry: {
          ...entry,
          draftData: { title: 'Same', $seo: { title: 'New' } },
          publishedData: { title: 'Same', $seo: { title: 'Old' } },
        },
      }).editedSinceReady,
    ).toBe(true)
    expect(
      formatEntry({
        ...options,
        entry: {
          ...entry,
          draftData: { title: 'Same', slug: 'same' },
          publishedData: { slug: 'same', title: 'Same' },
        },
      }).editedSinceReady,
    ).toBe(false)
  })

  it('keeps actual live snapshot fields separate from approved fields', () => {
    const out = formatEntry({
      entry,
      fields,
      ctx: ctx(),
      release: LIVE_AND_PENDING,
      previewAvailable: true,
      includePublished: true,
      liveFields: { title: 'Earlier deployment' },
    })
    expect(out.liveFields).toEqual({ title: 'Earlier deployment' })
    expect(out.approvedFields).toEqual({ title: 'Hello' })
  })

  it('formats frozen snapshot rich text, images and references', () => {
    expect(
      formatSnapshotFields(
        {
          body: {
            markdown: `![x](https://cms.test/api/assets/file/${STORAGE_KEY})`,
            json: {},
          },
          hero: {
            url: `https://cms.test/api/assets/file/${STORAGE_KEY}`,
            alt: 'Frozen alt',
            mimeType: 'image/png',
          },
          related: { id: 'other', collection: 'pages', slug: 'old-slug' },
          removedField: 'Still live',
        },
        lookup(),
      ),
    ).toEqual({
      body: `![x](asset:${ASSET_ID})`,
      hero: {
        assetId: ASSET_ID,
        url: `https://cms.test/api/assets/file/${STORAGE_KEY}`,
        alt: 'Frozen alt',
      },
      related: { entryId: 'other' },
      removedField: 'Still live',
    })
  })

  it('does not report edits to a draft that is not ready', () => {
    const out = formatEntry({
      entry: { ...entry, status: 'draft', publishedData: null },
      fields,
      ctx: ctx(empty),
      release: NOT_LIVE,
      previewAvailable: false,
      includePublished: false,
    })
    expect(out.status).toBe('draft')
    expect(out.editedSinceReady).toBe(false)
  })

  it('keeps collection fields named like system keys under fields only', () => {
    const named: Field[] = [
      { key: 'approvedAt', label: 'Approved at', type: 'date' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'live', label: 'Live', type: 'boolean' },
      { key: 'pendingRelease', label: 'Pending', type: 'boolean' },
    ]
    const out = formatEntry({
      entry: {
        ...entry,
        draftData: {
          approvedAt: '2026-01-01',
          status: 'news',
          live: true,
          pendingRelease: false,
        },
        publishedData: null,
        status: 'draft',
      },
      fields: named,
      ctx: ctx(empty),
      release: NOT_LIVE,
      previewAvailable: false,
      includePublished: false,
    })
    expect(out.fields).toEqual({
      approvedAt: '2026-01-01',
      status: 'news',
      live: true,
      pendingRelease: false,
    })
    expect(out.status).toBe('draft')
    expect(out.live).toBe(false)
    expect(out.pendingRelease).toBe(false)
    expect(out.approvedAt).toBe(now.toISOString())
  })
})

describe('summarizeEntry', () => {
  it('uses the title field and falls back to the first text field', () => {
    const base = {
      id: 'e',
      slug: 's',
      status: 'draft' as const,
      draftVersion: 1,
      updatedAt: new Date(0),
    }
    expect(
      summarizeEntry({ ...base, draftData: { title: 'T' } }, fields, NOT_LIVE)
        .title,
    ).toBe('T')
    expect(
      summarizeEntry(
        { ...base, draftData: { headline: 'H' } },
        [{ key: 'headline', label: 'H', type: 'text' }],
        NOT_LIVE,
      ).title,
    ).toBe('H')
  })

  it('shows ready and the release flags per row', () => {
    const row = summarizeEntry(
      {
        id: 'e',
        slug: 's',
        status: 'published',
        draftVersion: 2,
        draftData: { title: 'T' },
        updatedAt: new Date(0),
      },
      fields,
      { live: true, pendingRelease: false },
    )
    expect(row).toMatchObject({
      status: 'ready',
      live: true,
      pendingRelease: false,
    })
  })
})

describe('seoPatchFromInput', () => {
  it('turns the clearing spellings into nulls and keeps real values', () => {
    expect(
      seoPatchFromInput({
        title: '',
        noindex: false,
        keyTakeaways: [],
        faq: [{ question: 'Q', answer: 'A' }],
        description: 'Kept',
        nofollow: true,
      }),
    ).toEqual({
      title: null,
      noindex: null,
      keyTakeaways: null,
      faq: [{ question: 'Q', answer: 'A' }],
      description: 'Kept',
      nofollow: true,
    })
  })

  it('leaves an absent block absent', () => {
    expect(seoPatchFromInput(undefined)).toBeUndefined()
  })

  it('clears a key on merge when it is spelled as empty', () => {
    const patch = seoPatchFromInput({ title: '', summary: 'New summary' })
    expect(mergeSeo({ title: 'Old', summary: 'Old summary' }, patch)).toEqual({
      summary: 'New summary',
    })
  })
})
