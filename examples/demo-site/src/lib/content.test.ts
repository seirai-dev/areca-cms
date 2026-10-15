import { describe, expect, it } from 'vitest'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFixtureContent, FIXTURE_SLUGS } from '../../scripts/fixture-content.ts'
import { content } from '../generated/content/areca.gen.ts'
import {
  CONTENT_DIR,
  articlesByAuthor,
  articlesFeaturingCoffee,
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
import { referenceId } from './references.ts'

const [ethiopiaArticle, huilaArticle, bergenArticle] = FIXTURE_SLUGS.articles
const [ethiopia, brazil, colombia] = FIXTURE_SLUGS.coffees
const [ingrid, matti] = FIXTURE_SLUGS.authors

describe('content access', () => {
  it('reads articles newest first by publishedAt', async () => {
    await writeFixtureContent()
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

  it('returns a single article by slug and null when missing', async () => {
    await writeFixtureContent()
    expect(getArticle(huilaArticle)?.data.category).toBe('origin-stories')
    expect(getArticle('does-not-exist')).toBeNull()
  })

  it('orders coffees limited first, then by name', async () => {
    await writeFixtureContent()
    expect(getCoffees().map((coffee) => coffee.slug)).toEqual([ethiopia, brazil, colombia])
    expect(getCoffee(brazil)?.data.process).toBe('honey')
    expect(getCoffee('does-not-exist')).toBeNull()
  })

  it('orders authors by name and finds one by slug', async () => {
    await writeFixtureContent()
    expect(getAuthors().map((author) => author.data.name)).toEqual([
      'Ingrid Solberg',
      'Matti Haugen',
    ])
    expect(getAuthor(matti)?.data.role).toBe('Green coffee buyer')
    expect(getAuthor('does-not-exist')).toBeNull()
  })

  it('resolves references by id', async () => {
    await writeFixtureContent()
    const articles = getArticles()
    const huila = getArticle(huilaArticle)!
    const bergen = getArticle(bergenArticle)!

    expect(content.resolve(huila.data.author)?.slug).toBe(matti)
    expect(content.resolve(huila.data.featuredCoffee)?.slug).toBe(colombia)
    expect(content.resolve(bergen.data.featuredCoffee)).toBeNull()
    expect(content.resolve(bergen.data.author)?.slug).toBe(ingrid)
    expect(articlesByAuthor(getAuthor(ingrid)!.id, articles).map((a) => a.slug)).toEqual([
      bergenArticle,
      ethiopiaArticle,
    ])
    expect(
      articlesFeaturingCoffee(getCoffee(ethiopia)!.id, articles).map((a) => a.slug),
    ).toEqual([ethiopiaArticle])
  })

  it('reads a reference id only when the field is set', () => {
    expect(referenceId({ id: 'ent_1' })).toBe('ent_1')
    expect(referenceId('')).toBeUndefined()
    expect(referenceId(null)).toBeUndefined()
    expect(referenceId(undefined)).toBeUndefined()
  })

  it('builds hrefs from the schema routes', async () => {
    await writeFixtureContent()
    expect(content.coffees.href(ethiopia)).toBe(`/coffees/${ethiopia}`)
    expect(content.authors.href(matti)).toBe(`/team/${matti}`)
    expect(content.articles.href(getArticle(huilaArticle)!)).toBe(`/journal/${huilaArticle}`)
  })

  it('splits tasting notes on commas, trims and drops empties', async () => {
    await writeFixtureContent()
    const coffee = getCoffee(ethiopia)!
    expect(tastingNotes(coffee)).toEqual(['blueberry', 'jasmine', 'cacao nib'])

    const messy = {
      ...coffee,
      data: { ...coffee.data, tastingNotes: ' plum , ,, cocoa,  ' },
    }
    expect(tastingNotes(messy)).toEqual(['plum', 'cocoa'])
    expect(tastingNotes({ ...coffee, data: { ...coffee.data, tastingNotes: null } })).toEqual([])
  })

  it('lists every prerender page', async () => {
    await writeFixtureContent()
    expect(listPrerenderPages()).toEqual([
      '/',
      '/coffees',
      '/journal',
      '/team',
      '/about',
      '/nl/',
      '/nl/koffie',
      '/nl/journaal',
      '/nl/team',
      '/nl/over',
      `/coffees/${ethiopia}`,
      `/nl/koffie/${ethiopia}`,
      `/coffees/${brazil}`,
      `/coffees/${colombia}`,
      `/journal/${bergenArticle}`,
      `/journal/${ethiopiaArticle}`,
      '/nl/journaal/waarom-we-ethiopische-naturals-lichter-roosteren',
      `/journal/${huilaArticle}`,
      '/nl/journaal/een-jaar-direct-handelen-in-huila',
      `/team/${ingrid}`,
      `/team/${matti}`,
    ])
  })

  it('reads the fixture publication id and collection counts from the manifest', async () => {
    await writeFixtureContent()
    expect(getManifest()).toMatchObject({
      publicationId: 'pub_fixture_northbound',
      collections: { articles: 3, coffees: 3, authors: 2 },
    })
  })
})

describe('missing content', () => {
  it('returns an empty list for a collection absent from the manifest', async () => {
    await writeFixtureContent()
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
      await writeFixtureContent()
    }
  })

  it('throws a clear error when the manifest is absent', async () => {
    rmSync(CONTENT_DIR, { recursive: true, force: true })
    expect(() => getArticles()).toThrow(/areca pull/)
    await writeFixtureContent()
  })
})
