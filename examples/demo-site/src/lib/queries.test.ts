import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFixtureContent } from '../../scripts/fixture-content.ts'
import { content } from '../generated/content/areca.gen.ts'
import { CONTENT_DIR } from './content.ts'
import { aboutFrom, companyFrom, homeFrom } from './queries.ts'
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
