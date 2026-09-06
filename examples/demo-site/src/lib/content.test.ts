import { describe, expect, it } from 'vitest'
import { rmSync } from 'node:fs'
import { writeFixtureContent, FIXTURE_SLUGS } from '../../scripts/fixture-content.ts'
import {
  CONTENT_DIR,
  getArticle,
  getArticles,
  getManifest,
} from './content.ts'

describe('content access', () => {
  it('reads fixture articles by newest publishedAt', () => {
    writeFixtureContent()
    const articles = getArticles()

    expect(articles).toHaveLength(3)
    expect(articles.map((article) => article.slug)).toEqual([
      FIXTURE_SLUGS[2],
      FIXTURE_SLUGS[1],
      FIXTURE_SLUGS[0],
    ])
    expect(articles[0]?.data.title).toBe('Acme opens a Berlin office')
    expect(articles[0]?.data.category).toBe('news')
    expect(articles[0]?.data.body.html).toContain('Berlin')
    expect(articles[1]?.data.heroImage).toBeNull()
  })

  it('returns a single article by slug and undefined when missing', () => {
    writeFixtureContent()
    const article = getArticle('q1-product-updates')
    expect(article?.data.title).toBe('Q1 product updates')
    expect(article?.data.category).toBe('updates')
    expect(getArticle('does-not-exist')).toBeUndefined()
  })

  it('reads the fixture publication id from the manifest', () => {
    writeFixtureContent()
    expect(getManifest()).toMatchObject({
      publicationId: 'pub_fixture_acme',
      collections: { articles: 3 },
    })
    expect(CONTENT_DIR).toContain('src')
  })
})

describe('missing content', () => {
  it('throws a clear error when the collection file is absent', () => {
    rmSync(CONTENT_DIR, { recursive: true, force: true })
    expect(() => getArticles()).toThrow(/areca pull/)
    writeFixtureContent()
  })
})
