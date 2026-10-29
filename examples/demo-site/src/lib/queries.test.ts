import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ArecaClient, PreviewResult, SnapshotEntry } from '@areca-cms/site-sdk'
import { readContent, readContentManifest, readGlobalsFile } from '@areca-cms/site-sdk/pull'
import { FIXTURE_SLUGS, writeFixtureContent } from '../../scripts/fixture-content.ts'
import { content } from '../generated/content/areca.gen.ts'
import { CONTENT_DIR } from './content.ts'
import {
  aboutFrom,
  companyFrom,
  homeFrom,
  liveAboutData,
  liveHomeData,
  toPreviewLoad,
} from './page-data.server.ts'
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

describe('live site content', () => {
  /** A draft of a site content section, built from the fixture's published row as the CMS sends it. */
  async function globalDraft(
    section: 'homePage' | 'aboutPage',
    change: (data: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<PreviewResult> {
    await writeFixtureContent()
    const row = readGlobalsFile(CONTENT_DIR, readContentManifest(CONTENT_DIR))[section]
    if (!row) throw new Error(`Fixture section ${section} is missing`)
    return { kind: 'global', global: section, entry: { ...row, data: change({ ...row.data }) } }
  }

  it('shows a complete home page draft', async () => {
    const result = await globalDraft('homePage', (data) => ({
      ...data,
      heroIntro: 'An unsaved intro from the visual editor.',
    }))

    const home = await liveHomeData(result)
    expect(home.home.heroIntro).toBe('An unsaved intro from the visual editor.')
    expect(home).toMatchObject({ preview: true, incomplete: false, noindex: true })
  })

  it('keeps the published home page when the result is for another section', async () => {
    const published = homeFrom(content.globals)
    const result = await globalDraft('aboutPage', (data) => ({
      ...data,
      heading: 'An unsaved heading for the about page.',
    }))

    const home = await liveHomeData(result)
    expect(home.home).toEqual(published)
    expect(home).toMatchObject({ preview: false, incomplete: false })
  })

  it('keeps the published values and flags an incomplete draft', async () => {
    const published = homeFrom(content.globals)
    const result = await globalDraft('homePage', ({ heroIntro: _intro, ...data }) => ({
      ...data,
      heroEyebrow: 'Unsaved eyebrow',
    }))

    const home = await liveHomeData(result)
    expect(home.home).toEqual(published)
    expect(home).toMatchObject({ preview: true, incomplete: true })
  })

  it('shows a complete about page draft', async () => {
    const result = await globalDraft('aboutPage', (data) => ({
      ...data,
      heading: 'An unsaved heading.',
    }))

    const about = await liveAboutData(result)
    expect(about.about.heading).toBe('An unsaved heading.')
    expect(about).toMatchObject({ preview: true, incomplete: false, noindex: true })
  })
})
