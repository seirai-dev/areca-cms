import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { renderHtml } from '@tanstack/markdown/html'
import { parseMarkdown } from '@tanstack/markdown/parser'
import {
  manifestFromConfig,
  type ArecaClient,
  type CollectionConfig,
  type RichTextValue,
  type SeoMeta,
  type Snapshot,
  type SnapshotEntry,
  type SnapshotGlobal,
} from '@areca-cms/site-sdk'
import { pullContent } from '@areca-cms/site-sdk/pull'
import config from '../areca.config.ts'

/** Where `areca pull --out` writes in this app, so areca.gen.ts gets the same dir literal. */
const CONTENT_OUT = 'src/generated/content'
/** Same default as src/lib/content.ts; not imported from there because that module needs the generated file. */
const CONTENT_DIR = process.env.ARECA_CONTENT_DIR ?? join(process.cwd(), CONTENT_OUT)

export const FIXTURE_PUBLICATION_ID = 'pub_fixture_northbound'

/** The brand name in the copy below; the CMS company info section holds the same value. */
const COMPANY_NAME = 'Northbound Coffee Co.'
const HOME_DESCRIPTION = 'Small-batch specialty coffee, roasted in Bergen, Norway on a 15 kg Giesen.'

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

/** The schema the CMS embeds in a publication: a required slug field first, any other slug field dropped. */
function publicationSchema(): Record<string, CollectionConfig> {
  const { collections } = manifestFromConfig(config)
  return Object.fromEntries(
    Object.entries(collections).map(([key, collection]) => [
      key,
      {
        ...collection,
        fields: [
          { key: 'slug', label: 'Slug', type: 'slug', required: true },
          ...collection.fields.filter((field) => field.key !== 'slug'),
        ],
      },
    ]),
  )
}

/** A complete SEO block, as the CMS resolves it for a site content section with SEO on. */
function seo(title: string, description: string): SeoMeta {
  return {
    title,
    description,
    canonicalUrl: null,
    robots: { index: true, follow: true, content: 'index, follow' },
    focusKeyphrase: null,
    openGraph: {
      type: 'website',
      title,
      description,
      url: null,
      siteName: COMPANY_NAME,
      image: null,
      publishedTime: null,
      modifiedTime: null,
    },
    twitter: { card: 'summary', title, description, image: null },
    author: null,
    summary: null,
    keyTakeaways: [],
    faq: [],
    about: [],
    jsonLd: [],
  }
}

/** Serves one snapshot to `pullContent`; the other client calls are never made. */
function fixtureClient(snapshot: Snapshot): ArecaClient {
  const unused = (): never => {
    throw new Error('The fixture client only serves the fixture snapshot.')
  }
  return {
    syncManifest: unused,
    fetchManifest: unused,
    fetchSnapshot: async () => snapshot,
    fetchPreview: unused,
    fetchAsset: unused,
  }
}

/** One language of an entry or section, as the CMS ships it: its slug (collections), data and SEO. */
type Translation = { slug?: string; data: Record<string, unknown>; seo?: SeoMeta }

/**
 * Dutch translations, by raw entry id (`id` in the table above). Entries and
 * sections without one ship in English only, and visitors to /nl get the
 * English version with `isFallback` set. `bergen` is left untranslated on
 * purpose, so the fallback is visible.
 */
function dutchTranslations(): Record<string, Translation> {
  return {
    ent_article_ethiopia: {
      slug: 'waarom-we-ethiopische-naturals-lichter-roosteren',
      data: {
        title: 'Waarom we Ethiopische naturals lichter roosteren',
        excerpt:
          'Natuurlijk verwerkte Ethiopiërs zijn broos en fruitig. Ons branderschema houdt de bosbes en laat de bitterheid achterwege.',
        body: richText(
          "Natuurlijk verwerkte koffie bevat meer suiker en fragielere aroma's dan gewassen partijen. Brand je ze te donker, dan wordt het fruit tot jam.\n\n## Onze aanpak\n\nWe stoppen het roosteren ongeveer een minuut eerder dan bij een gewassen Colombiaan en laten de bonen daarna vijf dagen rusten voordat ze de deur uitgaan.\n\n> Als de kop vlak smaakt, brand dan lichter, niet donkerder.\n\nProbeer de Guji natural als filterkoffie op 94 °C met een verhouding van 1:16.",
        ),
        heroImage: imageValue('heroEthiopia', 'Koffiekersen drogen op verhoogde bedden in Guji'),
      },
    },
    ent_article_huila: {
      slug: 'een-jaar-direct-handelen-in-huila',
      data: {
        title: 'Een jaar direct handelen in Huila',
        excerpt:
          'Prijzen vooraf afgesproken, een proeftafel op de boerderij en wat drie seizoenen samen ons hebben geleerd.',
        body: richText(
          'Matti bezocht Finca La Esperanza voor het eerst in 2022. Sindsdien kopen we er elk seizoen, tegen een prijs die we vóór de pluk afspreken.\n\n## Wat er veranderde\n\nDe boerderij houdt nu partijgegevens bij die we kunnen afzetten tegen onze eigen brandnotities. Die terugkoppeling is het echte voordeel van direct handelen.\n\n- Prijzen vóór de oogst afgesproken\n- Monsters geproefd op de boerderij\n- Feedback van beide kanten',
        ),
      },
    },
    ent_coffee_ethiopia: {
      data: {
        origin: 'Ethiopië',
        tastingNotes: 'bosbes, jasmijn, cacaonib',
        description: richText(
          'Twee tot drie weken gedroogd op verhoogde bedden. Deze partij smaakt als een rijpe bessentaart. We branden hem licht zodat de jasmijn in de kop blijft.\n\nDit jaar zijn er maar 60 zakken geïmporteerd.',
        ),
      },
    },
    ent_global_company_info: {
      data: {
        tagline:
          'Rechtstreeks inkopen bij boerderijen die we kennen, en in kleine batches met de hand roosteren aan de kust van Bergen.',
      },
    },
    ent_global_home_page: {
      data: {
        heroEyebrow: 'Branderij in Bergen, Noorwegen',
        heroIntro: `${COMPANY_NAME} koopt rechtstreeks bij producenten en brandt elke partij in kleine batches op een Giesen van 15 kg. Dit zit er dit seizoen in de winkel.`,
      },
      seo: seo('Specialty koffie uit Bergen', 'Specialty koffie in kleine batches, geroosterd in Bergen, Noorwegen, op een Giesen van 15 kg.'),
    },
    ent_global_about_page: {
      data: {
        heading: 'Een kleine branderij aan de haven van Bergen.',
        body: richText(
          [
            'Northbound Coffee Co. begon in 2016 met één tweedehands brander en een schrift vol cuppingscores.',
            'We zijn nog steeds een klein team in Bergen, Noorwegen, en we branden elke batch nog steeds zelf.',
            '> Elke partij die nog niet klaar is, leggen we opzij.',
            'We branden op een Giesen van 15 kg in batches die klein genoeg zijn om goed in de gaten te houden. Zo kunnen we elke partij met de hand profileren, het roosteren vertragen wanneer een koffie tijd nodig heeft en batches opzijzetten die niet klaar zijn. Geroosterde koffie gaat binnen een paar weken de deur uit, met de roostdatum op de zak.',
            'We kopen direct in. Onze inkoper spreekt prijzen af met producenten vóór de oogst, proeft monsters op de boerderij en deelt roostersfeedback van beide kanten. Lees meer over de boerderijen in het [journaal](/nl/journaal), of maak kennis met de [mensen](/nl/team) achter elke partij.',
          ].join('\n\n'),
        ),
      },
      seo: seo(
        'Over ons',
        'Northbound Coffee Co. is een kleine branderij in Bergen, Noorwegen, opgericht in 2016. Wij kopen direct in en branden in kleine batches.',
      ),
    },
  }
}

/**
 * Adds the language fields to a publication entry or section: `locale` (the
 * base language, English here) and `locales` with one view per complete
 * language. A translation's data is merged over the base, so shared fields
 * (author, price, image) stay the same.
 */
function withLocales<T extends SnapshotEntry | SnapshotGlobal>(
  item: T,
  translation: Translation | undefined,
  collection: boolean,
): T {
  const base: Translation = { slug: collection ? (item as SnapshotEntry).slug : undefined, data: item.data, seo: item.seo }
  const en = {
    ...(collection ? { slug: base.slug } : {}),
    data: base.data,
    ...(base.seo ? { seo: base.seo } : {}),
  }
  const locales: Record<string, Record<string, unknown>> = { en }
  if (translation) {
    const data = { ...base.data, ...translation.data }
    if (collection && translation.slug) data.slug = translation.slug
    locales.nl = {
      ...(collection ? { slug: translation.slug ?? base.slug } : {}),
      data,
      ...(translation.seo ? { seo: translation.seo } : {}),
    }
  }
  return { ...item, locale: 'en', locales } as T
}

/**
 * Writes the fixture as a CMS publication (raw keys, embedded schema) and runs
 * it through `pullContent`, so the files, manifest and areca.gen.ts are what
 * `areca pull` produces.
 */
export async function writeFixtureContent(outDir = CONTENT_DIR, mediaDir = MEDIA_DIR): Promise<void> {
  mkdirSync(mediaDir, { recursive: true })
  for (const image of Object.values(IMAGES)) {
    const [width, height] = image.size
    writeFileSync(join(mediaDir, image.file), solidPng(width, height, [...image.rgb] as [number, number, number]))
  }

  const [ingrid, matti] = FIXTURE_SLUGS.authors
  const [ethiopia, brazil, colombia] = FIXTURE_SLUGS.coffees
  const [ethiopiaArticle, huilaArticle, bergenArticle] = FIXTURE_SLUGS.articles

  const authors: SnapshotEntry[] = [
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

  const coffees: SnapshotEntry[] = [
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

  const articles: SnapshotEntry[] = [
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

  const globals: Record<string, SnapshotGlobal> = {
    companyInfo: {
      id: 'ent_global_company_info',
      publishedAt: '2026-10-01T10:00:00.000Z',
      data: {
        name: COMPANY_NAME,
        tagline:
          'Buying direct from the farms we know, roasting small batches by hand on the Bergen coast.',
        address: 'Strandkaien 14, 5013 Bergen, Norway',
        email: 'hello@northbound.example',
        phone: null,
        instagramUrl: null,
        foundedYear: 2016,
      },
    },
    homePage: {
      id: 'ent_global_home_page',
      publishedAt: '2026-10-01T10:00:00.000Z',
      data: {
        heroEyebrow: 'Roasters in Bergen, Norway',
        heroIntro: `${COMPANY_NAME} buys directly from producers and roasts every lot in small batches on a 15 kg Giesen. Here is what we have on the shelf this season.`,
        featuredCoffee: { collection: 'coffees', slug: ethiopia, id: 'ent_coffee_ethiopia' },
      },
      seo: seo('Specialty coffee roasted in Bergen', HOME_DESCRIPTION),
    },
    aboutPage: {
      id: 'ent_global_about_page',
      publishedAt: '2026-10-01T10:00:00.000Z',
      data: {
        heading: 'A small roastery on the Bergen harbour.',
        body: richText(
          [
            'Northbound Coffee Co. started in 2016 with one secondhand roaster and a notebook of cupping scores.',
            'We are still a small team in Bergen, Norway, and we still roast every batch ourselves.',
            '> We set aside any batch that is not ready.',
            'We roast on a 15 kg Giesen in batches small enough to watch closely. That lets us profile each lot by hand, slow the roast when a coffee needs time, and set aside any batch that is not ready. Roasted coffee is sold within a few weeks, with the roast date on the bag.',
            'We buy direct. Our buyer agrees prices with producers before harvest, cups samples at origin and shares roasting feedback both ways. Read more about the farms in the [journal](/journal), or meet the [people](/team) behind each lot.',
          ].join('\n\n'),
        ),
        image: imageValue('heroHuila', 'Rows of coffee trees on a hillside in Huila'),
        foundedYear: 2016,
        roasterCapacityKg: 15,
        originsCount: 3,
      },
      seo: seo(
        'About',
        'Northbound Coffee Co. is a small roastery in Bergen, Norway, founded in 2016. We buy direct and roast in small batches.',
      ),
    },
  }

  const translated = dutchTranslations()
  const localized = <T extends SnapshotEntry>(items: T[]) =>
    items.map((item) => withLocales(item, translated[item.id], true))
  const snapshot: Snapshot = {
    publicationId: FIXTURE_PUBLICATION_ID,
    siteKey: config.siteKey,
    createdAt: '2026-10-01T10:00:00.000Z',
    hash: 'fixture-northbound-sha256',
    languages: config.languages,
    collections: {
      articles: localized(articles),
      coffees: localized(coffees),
      authors: localized(authors),
    },
    schema: publicationSchema(),
    globals: Object.fromEntries(
      Object.entries(globals).map(([key, section]) => [
        key,
        withLocales(section, translated[section.id], false),
      ]),
    ),
    globalSchema: manifestFromConfig(config).globals ?? {},
  }

  mkdirSync(outDir, { recursive: true })
  await pullContent({
    outDir,
    client: fixtureClient(snapshot),
    publicationId: FIXTURE_PUBLICATION_ID,
    contentDir: CONTENT_OUT,
    // The same runtime path `areca pull` resolves from i18n.paraglide.
    ...(config.i18n?.paraglide
      ? { paraglide: join(process.cwd(), config.i18n.paraglide) }
      : {}),
  })
}

const isCli = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/fixture-content.ts')
if (isCli) {
  await writeFixtureContent()
  console.log(
    `Wrote fixture publication ${FIXTURE_PUBLICATION_ID} (articles, coffees, authors, site content) and areca.gen.ts to ${CONTENT_DIR}`,
  )
}
