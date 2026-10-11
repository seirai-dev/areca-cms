import { describe, expect, it } from 'vitest'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFixtureContent, FIXTURE_SLUGS } from '../../scripts/fixture-content.ts'
import {
  CONTENT_DIR,
  articlesByAuthor,
  articlesFeaturingCoffee,
  authorFor,
  coffeeFor,
  getArticle,
  getArticles,
  getAuthor,
  getAuthors,
  getCoffee,
  getCoffees,
  getManifest,
  listPrerenderPages,
  tastingNotes,
} from './content.ts'

const [ethiopiaArticle, huilaArticle, bergenArticle] = FIXTURE_SLUGS.articles
const [ethiopia, brazil, colombia] = FIXTURE_SLUGS.coffees
const [ingrid, matti] = FIXTURE_SLUGS.authors

describe('content access', () => {
  it('reads articles newest first by publishedAt', () => {
    writeFixtureContent()
    const articles = getArticles()

    expect(articles.map((article) => article.slug)).toEqual([
      bergenArticle,
      ethiopiaArticle,
      huilaArticle,
    ])
    expect(articles[0]?.data.title).toBe('Opening day at the Bergen roastery')
    expect(articles[1]?.data.body?.html).toContain('Guji')
    expect(articles[0]?.data.heroImage).toBeNull()
  })

  it('returns a single article by slug and null when missing', () => {
    writeFixtureContent()
    expect(getArticle(huilaArticle)?.data.category).toBe('origin-stories')
    expect(getArticle('does-not-exist')).toBeNull()
  })

  it('orders coffees limited first, then by name', () => {
    writeFixtureContent()
    expect(getCoffees().map((coffee) => coffee.slug)).toEqual([ethiopia, brazil, colombia])
    expect(getCoffee(brazil)?.data.process).toBe('honey')
    expect(getCoffee('does-not-exist')).toBeNull()
  })

  it('orders authors by name and finds one by slug', () => {
    writeFixtureContent()
    expect(getAuthors().map((author) => author.data.name)).toEqual([
      'Ingrid Solberg',
      'Matti Haugen',
    ])
    expect(getAuthor(matti)?.data.role).toBe('Green coffee buyer')
    expect(getAuthor('does-not-exist')).toBeNull()
  })

  it('resolves references by id', () => {
    writeFixtureContent()
    const articles = getArticles()
    const huila = getArticle(huilaArticle)!
    const bergen = getArticle(bergenArticle)!

    expect(authorFor(huila)?.slug).toBe(matti)
    expect(coffeeFor(huila)?.slug).toBe(colombia)
    expect(coffeeFor(bergen)).toBeNull()
    expect(articlesByAuthor(getAuthor(ingrid)!.id, articles).map((a) => a.slug)).toEqual([
      bergenArticle,
      ethiopiaArticle,
    ])
    expect(
      articlesFeaturingCoffee(getCoffee(ethiopia)!.id, articles).map((a) => a.slug),
    ).toEqual([ethiopiaArticle])
  })

  it('splits tasting notes on commas, trims and drops empties', () => {
    writeFixtureContent()
    const coffee = getCoffee(ethiopia)!
    expect(tastingNotes(coffee)).toEqual(['blueberry', 'jasmine', 'cacao nib'])

    const messy = {
      ...coffee,
      data: { ...coffee.data, tastingNotes: ' plum , ,, cocoa,  ' },
    }
    expect(tastingNotes(messy)).toEqual(['plum', 'cocoa'])
    expect(tastingNotes({ ...coffee, data: { ...coffee.data, tastingNotes: null } })).toEqual([])
  })

  it('lists every prerender page', () => {
    writeFixtureContent()
    expect(listPrerenderPages()).toEqual([
      '/',
      '/coffees',
      '/journal',
      '/team',
      '/about',
      `/coffees/${ethiopia}`,
      `/coffees/${brazil}`,
      `/coffees/${colombia}`,
      `/journal/${bergenArticle}`,
      `/journal/${ethiopiaArticle}`,
      `/journal/${huilaArticle}`,
      `/team/${ingrid}`,
      `/team/${matti}`,
    ])
  })

  it('reads the fixture publication id and collection counts from the manifest', () => {
    writeFixtureContent()
    expect(getManifest()).toMatchObject({
      publicationId: 'pub_fixture_northbound',
      collections: { articles: 3, coffees: 3, authors: 2 },
    })
    expect(CONTENT_DIR).toContain('src')
  })
})

describe('missing content', () => {
  it('returns an empty list for a collection absent from the manifest', () => {
    writeFixtureContent()
    const manifestPath = join(CONTENT_DIR, 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    delete manifest.collections.coffees
    writeFileSync(manifestPath, JSON.stringify(manifest))

    try {
      expect(getCoffees()).toEqual([])
      expect(getCoffee(ethiopia)).toBeNull()
      expect(listPrerenderPages()).not.toContain(`/coffees/${ethiopia}`)
      expect(getArticles()).toHaveLength(3)
    } finally {
      writeFixtureContent()
    }
  })

  it('throws a clear error when the manifest is absent', () => {
    rmSync(CONTENT_DIR, { recursive: true, force: true })
    expect(() => getArticles()).toThrow(/areca pull/)
    writeFixtureContent()
  })
})
