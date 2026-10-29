import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ArecaClient, PreviewResult, SnapshotEntry } from '@areca-cms/site-sdk'
import { readContent } from '@areca-cms/site-sdk/pull'
import { FIXTURE_SLUGS, writeFixtureContent } from '../../scripts/fixture-content.ts'
import { content } from '../generated/content/areca.gen.ts'
import { CONTENT_DIR } from './content.ts'
import { aboutFrom, companyFrom, homeFrom, toPreviewLoad } from './page-data.server.ts'
import { cmsOriginFrom, livePreviewInput } from './queries.ts'
import { SITE_DESCRIPTION, SITE_NAME, sectionHead } from './seo.ts'

describe('site content sections', () => {
  it('reads the published values when the publication has them', async () => {
    await writeFixtureContent()
    expect(companyFrom(content.globals).name).toBe(SITE_NAME)
    expect(homeFrom(content.globals).heroEyebrow).toBe('Roasters in Bergen, Norway')
    expect(aboutFrom(content.globals).foundedYear).toBe(2016)
  })

  it('falls back when the publication has no site content', async () => {
    await writeFixtureContent()
    const manifestPath = join(CONTENT_DIR, 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    delete manifest.globals
    writeFileSync(manifestPath, JSON.stringify(manifest))

    try {
      expect(content.globals).toEqual({})
      expect(companyFrom(content.globals)).toEqual({ name: SITE_NAME })

      const home = homeFrom(content.globals)
      expect(home.heroEyebrow).toBeNull()
      expect(home.heroIntro).toBe(SITE_DESCRIPTION)
      expect(content.resolve(home.featuredCoffee)).toBeNull()
      expect(sectionHead(home.$seo, { description: SITE_DESCRIPTION }).meta).toContainEqual({
        name: 'description',
        content: SITE_DESCRIPTION,
      })

      const about = aboutFrom(content.globals)
      expect(about.heading).toBe(SITE_NAME)
      expect(about.body).toBeNull()
      expect(about.foundedYear).toBeNull()
    } finally {
      await writeFixtureContent()
    }
  })
})

describe('live preview', () => {
  /** A draft of the fixture's first coffee, as the CMS sends it: the raw published values. */
  async function coffeeDraft(): Promise<PreviewResult> {
    await writeFixtureContent()
    const [ethiopia] = FIXTURE_SLUGS.coffees
    // Raw snapshot rows, as the CMS sends them (content.ts does the same cast).
    const rows = readContent(CONTENT_DIR, 'coffees') as unknown as SnapshotEntry[]
    const entry = rows.find((item) => item.slug === ethiopia)
    if (!entry) throw new Error(`Fixture coffee ${ethiopia} is missing`)
    return { collection: 'coffees', slug: ethiopia, entry }
  }

  it('renders a live result the same way the saved preview does', async () => {
    const result = await coffeeDraft()
    const client = { fetchPreview: async () => result } as unknown as ArecaClient

    const saved = toPreviewLoad(await content.preview('preview-token', { client }))
    const live = toPreviewLoad(content.previewFrom(result))

    expect(live).toEqual(saved)
    expect(live).toMatchObject({ ok: true, complete: true, preview: { collection: 'coffees' } })
  })

  it('lists the issues of an incomplete unsaved draft', async () => {
    const result = await coffeeDraft()
    if (result.kind === 'global') throw new Error('expected an entry')
    const { name: _name, ...data } = result.entry.data
    const incomplete: PreviewResult = { ...result, entry: { ...result.entry, data } }

    const load = toPreviewLoad(content.previewFrom(incomplete))
    expect(load).toMatchObject({ ok: true, complete: false, collection: 'coffees' })
    expect(load.ok && !load.complete ? load.issues.length : 0).toBeGreaterThan(0)
  })

  it('accepts an entry result, with or without kind', async () => {
    const result = await coffeeDraft()
    expect(livePreviewInput.safeParse(result).success).toBe(true)
    expect(livePreviewInput.safeParse({ ...result, kind: 'entry' }).success).toBe(true)
  })

  it('rejects a site content result', async () => {
    const result = await coffeeDraft()
    const global = {
      kind: 'global',
      global: 'companyInfo',
      collection: result.kind === 'global' ? undefined : result.collection,
      slug: result.kind === 'global' ? undefined : result.slug,
      entry: result.kind === 'global' ? undefined : result.entry,
    }
    expect(livePreviewInput.safeParse(global).success).toBe(false)
  })

  it('reads the CMS origin from a URL and drops paths and invalid values', () => {
    expect(cmsOriginFrom('https://cms.example.com/')).toBe('https://cms.example.com')
    expect(cmsOriginFrom('http://localhost:3000/some/path')).toBe('http://localhost:3000')
    expect(cmsOriginFrom(undefined)).toBeNull()
    expect(cmsOriginFrom('')).toBeNull()
    expect(cmsOriginFrom('   ')).toBeNull()
    expect(cmsOriginFrom('not a url')).toBeNull()
    expect(cmsOriginFrom('file:///tmp/cms')).toBeNull()
  })
})
