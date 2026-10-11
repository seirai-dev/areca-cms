import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { renderHtml } from '@tanstack/markdown/html'
import { parseMarkdown } from '@tanstack/markdown/parser'
import type { PulledContentManifest, RichTextValue } from '@areca-cms/site-sdk'
import {
  CONTENT_DIR,
  type Article,
  type Author,
  type Coffee,
} from '../src/lib/content.ts'

export const FIXTURE_PUBLICATION_ID = 'pub_fixture_northbound'

export const FIXTURE_SLUGS = {
  articles: [
    'why-we-roast-ethiopian-naturals-lighter',
    'direct-trade-in-huila',
    'bergen-roastery-opening',
  ],
  coffees: [
    'ethiopia-guji-natural',
    'brazil-cerrado-honey',
    'colombia-huila-washed',
  ],
  authors: ['ingrid-solberg', 'matti-haugen'],
} as const

/** Mirrors the CMS: markdown is canonical, document and html derive from it. */
function richText(markdown: string): RichTextValue {
  const document = parseMarkdown(markdown, { frontmatter: false })
  return {
    json: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: markdown.replace(/\n+/g, ' ') }],
        },
      ],
    },
    markdown,
    document,
    html: renderHtml(document),
  }
}

/** Where `areca pull` copies media for this site (see areca.config.ts). */
export const MEDIA_DIR =
  process.env.ARECA_MEDIA_DIR ?? join(process.cwd(), 'public/areca')

/** A solid-colour PNG, so fixtures work offline like pulled media does. */
function solidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const row = Buffer.alloc(1 + width * 3)
  for (let x = 0; x < width; x += 1) row.set(rgb, 1 + x * 3)
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const IMAGES = {
  coffeeEthiopia: { file: 'northbound-coffee-ethiopia.png', size: [800, 800], rgb: [214, 150, 72] },
  coffeeBrazil: { file: 'northbound-coffee-brazil.png', size: [800, 800], rgb: [120, 78, 50] },
  coffeeColombia: { file: 'northbound-coffee-colombia.png', size: [800, 800], rgb: [168, 84, 52] },
  heroEthiopia: { file: 'northbound-hero-ethiopia.png', size: [1600, 900], rgb: [236, 190, 120] },
  heroHuila: { file: 'northbound-hero-huila.png', size: [1600, 900], rgb: [150, 110, 80] },
  portraitIngrid: { file: 'northbound-portrait-ingrid.png', size: [800, 800], rgb: [200, 160, 130] },
  portraitMatti: { file: 'northbound-portrait-matti.png', size: [800, 800], rgb: [176, 120, 96] },
} as const

type ImageKey = keyof typeof IMAGES

function imageValue(key: ImageKey, alt: string) {
  const image = IMAGES[key]
  return {
    url: `/areca/${image.file}`,
    width: image.size[0],
    height: image.size[1],
    alt,
    mimeType: 'image/png',
  }
}

export interface FixtureContent {
  articles: Article[]
  coffees: Coffee[]
  authors: Author[]
}

export function writeFixtureContent(outDir = CONTENT_DIR, mediaDir = MEDIA_DIR): FixtureContent {
  mkdirSync(mediaDir, { recursive: true })
  for (const image of Object.values(IMAGES)) {
    const [width, height] = image.size
    writeFileSync(join(mediaDir, image.file), solidPng(width, height, [...image.rgb] as [number, number, number]))
  }

  const [ingrid, matti] = FIXTURE_SLUGS.authors
  const [ethiopia, brazil, colombia] = FIXTURE_SLUGS.coffees
  const [ethiopiaArticle, huilaArticle, bergenArticle] = FIXTURE_SLUGS.articles

  const authors: Author[] = [
    {
      id: 'ent_author_ingrid',
      slug: ingrid,
      publishedAt: null,
      data: {
        name: 'Ingrid Solberg',
        slug: ingrid,
        role: 'Founder and head roaster',
        bio: 'Ingrid started Northbound in 2016 with a secondhand roaster and a notebook of cupping scores. She still profiles every new lot herself.',
        portrait: imageValue('portraitIngrid', 'Ingrid Solberg standing by the roaster'),
      },
    },
    {
      id: 'ent_author_matti',
      slug: matti,
      publishedAt: null,
      data: {
        name: 'Matti Haugen',
        slug: matti,
        role: 'Green coffee buyer',
        bio: 'Matti travels to origin twice a year to taste samples and agree prices with producers before harvest.',
        portrait: imageValue('portraitMatti', 'Matti Haugen holding a sack of green coffee'),
      },
    },
  ]

  const coffees: Coffee[] = [
    {
      id: 'ent_coffee_ethiopia',
      slug: ethiopia,
      publishedAt: '2026-01-20T10:00:00.000Z',
      data: {
        name: 'Ethiopia Guji Natural',
        slug: ethiopia,
        origin: 'Ethiopia',
        region: 'Guji',
        producer: 'Guji smallholder cooperative',
        process: 'natural',
        roastLevel: 'light',
        tastingNotes: 'blueberry, jasmine, cacao nib',
        altitude: 2050,
        price: 18.5,
        limited: true,
        harvestDate: '2026-01-14',
        image: imageValue('coffeeEthiopia', 'Bag of Ethiopia Guji Natural beans'),
        description: richText(
          'Dried on raised beds for three weeks, this lot tastes like a ripe berry tart. We roast it light so the jasmine stays on the cup.\n\nOnly 60 bags were imported this year.',
        ),
        shopUrl: 'https://shop.example.com/ethiopia-guji-natural',
      },
    },
    {
      id: 'ent_coffee_brazil',
      slug: brazil,
      publishedAt: '2026-06-22T10:00:00.000Z',
      data: {
        name: 'Brazil Cerrado Honey',
        slug: brazil,
        origin: 'Brazil',
        region: 'Cerrado Mineiro',
        producer: 'Fazenda Santa Clara',
        process: 'honey',
        roastLevel: 'medium-dark',
        tastingNotes: 'hazelnut, milk chocolate, orange peel',
        altitude: 1100,
        price: 11.5,
        limited: false,
        harvestDate: '2026-06-20',
        image: imageValue('coffeeBrazil', 'Bag of Brazil Cerrado Honey beans'),
        description: richText(
          'Pulped with some of the sweet mucilage left on, then dried slowly. A dependable everyday coffee with a soft, chocolatey finish.',
        ),
        shopUrl: null,
      },
    },
    {
      id: 'ent_coffee_colombia',
      slug: colombia,
      publishedAt: '2025-12-05T10:00:00.000Z',
      data: {
        name: 'Colombia Huila Washed',
        slug: colombia,
        origin: 'Colombia',
        region: 'Huila',
        producer: 'Finca La Esperanza',
        process: 'washed',
        roastLevel: 'medium',
        tastingNotes: 'red apple, panela, black tea',
        altitude: 1800,
        price: 14.9,
        limited: false,
        harvestDate: '2025-12-02',
        image: imageValue('coffeeColombia', 'Bag of Colombia Huila Washed beans'),
        description: richText(
          'Our direct-trade partner Finca La Esperanza has supplied this lot for three seasons. Clean, sweet and balanced.',
        ),
        shopUrl: 'https://shop.example.com/colombia-huila-washed',
      },
    },
  ]

  const articles: Article[] = [
    {
      id: 'ent_article_ethiopia',
      slug: ethiopiaArticle,
      publishedAt: '2026-09-02T09:00:00.000Z',
      data: {
        title: 'Why we roast Ethiopian naturals lighter',
        slug: ethiopiaArticle,
        excerpt:
          'Natural-process Ethiopians are fragile and fruity. Our roast curve keeps the blueberry and leaves the bitterness behind.',
        body: richText(
          'Natural coffees carry more sugar and more fragile aromatics than washed lots. Roast them too dark and the fruit turns to jam.\n\n## Our approach\n\nWe stop the roast about one minute earlier than we would for a washed Colombian, then rest the beans for five days before they go out.\n\n> If the cup tastes flat, roast it lighter, not darker.\n\nTry the Guji natural as a filter brew at 94 °C with a 1:16 ratio.',
        ),
        heroImage: imageValue('heroEthiopia', 'Coffee cherries drying on raised beds in Guji'),
        category: 'brewing',
        author: { collection: 'authors', slug: ingrid, id: 'ent_author_ingrid' },
        featuredCoffee: { collection: 'coffees', slug: ethiopia, id: 'ent_coffee_ethiopia' },
        publishedAt: '2026-09-02T09:00:00.000Z',
      },
    },
    {
      id: 'ent_article_huila',
      slug: huilaArticle,
      publishedAt: '2026-07-15T08:30:00.000Z',
      data: {
        title: 'A year of direct trade in Huila',
        slug: huilaArticle,
        excerpt:
          'Prices agreed before harvest, a cupping table in the farm office, and what three seasons together have taught us.',
        body: richText(
          'Matti first visited Finca La Esperanza in 2022. We have bought from them every season since, paying a price agreed before the picking starts.\n\n## What changed\n\nThe farm now keeps lot records that we can cup against our own roast notes. That feedback loop is the real benefit of direct trade.\n\n- Prices agreed before harvest\n- Samples cupped at origin\n- Feedback shared both ways',
        ),
        heroImage: imageValue('heroHuila', 'Rows of coffee trees on a hillside in Huila'),
        category: 'origin-stories',
        author: { collection: 'authors', slug: matti, id: 'ent_author_matti' },
        featuredCoffee: { collection: 'coffees', slug: colombia, id: 'ent_coffee_colombia' },
        publishedAt: '2026-07-15T08:30:00.000Z',
      },
    },
    {
      id: 'ent_article_bergen',
      slug: bergenArticle,
      publishedAt: '2026-10-01T10:00:00.000Z',
      data: {
        title: 'Opening day at the Bergen roastery',
        slug: bergenArticle,
        excerpt:
          'Doors open on the harbour side with a bar, a tasting room and the roaster in full view.',
        body: richText(
          'This autumn we moved the roastery into a converted warehouse by the harbour in Bergen.\n\nCome by on Saturdays for cupping sessions. The first batch off the new roaster was a Brazil Cerrado Honey, which seemed fitting.',
        ),
        heroImage: null,
        category: 'roastery-news',
        author: { collection: 'authors', slug: ingrid, id: 'ent_author_ingrid' },
        featuredCoffee: null,
        publishedAt: '2026-10-01T10:00:00.000Z',
      },
    },
  ]

  const manifest: PulledContentManifest = {
    publicationId: FIXTURE_PUBLICATION_ID,
    hash: 'fixture-northbound-sha256',
    createdAt: '2026-10-01T10:00:00.000Z',
    collections: {
      articles: articles.length,
      coffees: coffees.length,
      authors: authors.length,
    },
    assets: { publicPath: '/areca', count: Object.keys(IMAGES).length },
  }

  mkdirSync(outDir, { recursive: true })
  const write = (name: string, value: unknown) =>
    writeFileSync(join(outDir, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  write('manifest.json', manifest)
  write('articles.json', articles)
  write('coffees.json', coffees)
  write('authors.json', authors)
  return { articles, coffees, authors }
}

const isCli = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/fixture-content.ts')
if (isCli) {
  const { articles, coffees, authors } = writeFixtureContent()
  console.log(
    `Wrote fixture publication ${FIXTURE_PUBLICATION_ID} (${articles.length} articles, ${coffees.length} coffees, ${authors.length} authors) to ${CONTENT_DIR}`,
  )
}
