// schema.org JSON-LD builders. Each returns one node for the page's @graph.
// Nodes point at each other by @id, so search engines and AI answer engines
// see one connected set of facts instead of loose snippets.
//
// Shared core: apps/landing and apps/docs keep identical copies of this file
// and head.ts. Change both together.
import type { SeoSite } from './config'

type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | Array<JsonValue>
export type JsonObject = { [key: string]: JsonValue }
/** One JSON-LD node. Undefined fields are dropped. */
export type JsonLd = JsonObject & { '@type': string | Array<string> }

type Input = { [key: string]: JsonValue | undefined }

/** Drops undefined fields and empty arrays so the output stays clean. */
function node(type: string | Array<string>, fields: Input): JsonLd {
  const out: JsonLd = { '@type': type }
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue
    if (Array.isArray(value) && value.length === 0) continue
    out[key] = value
  }
  return out
}

/** Stable @id for a node: the URL it belongs to plus a fragment. */
export function idFor(url: string, fragment: string): string {
  return `${url.replace(/\/$/, '')}/#${fragment}`
}

export const ref = (id: string): JsonObject => ({ '@id': id })

export const ids = {
  organization: (site: SeoSite) => idFor(site.organization.url, 'organization'),
  software: (site: SeoSite) => idFor(site.organization.url, 'software'),
  website: (site: SeoSite) => idFor(site.url, 'website'),
  webPage: (url: string) => `${url}#webpage`,
  breadcrumb: (url: string) => `${url}#breadcrumb`,
  faq: (url: string) => `${url}#faq`,
  video: (url: string) => `${url}#video`,
  howTo: (url: string) => `${url}#howto`,
  itemList: (url: string) => `${url}#list`,
}

export function organization(site: SeoSite): JsonLd {
  const org = site.organization
  return node('Organization', {
    '@id': ids.organization(site),
    name: org.name,
    url: org.url,
    description: org.description,
    logo: node('ImageObject', {
      '@id': idFor(org.url, 'logo'),
      url: org.logo,
      contentUrl: org.logo,
      caption: org.name,
    }),
    sameAs: org.sameAs,
  })
}

export function website(site: SeoSite): JsonLd {
  return node('WebSite', {
    '@id': ids.website(site),
    url: site.url,
    name: site.name,
    description: site.description,
    inLanguage: site.language,
    publisher: ref(ids.organization(site)),
    about: ref(ids.software(site)),
  })
}

export function webPage(
  site: SeoSite,
  page: {
    url: string
    type?: string | Array<string>
    name: string
    description: string
    image?: string
    published?: string
    modified?: string
    hasBreadcrumb?: boolean
    /** @id of the thing the page is about. */
    about?: string
    /** @id of the page's main content, such as an ItemList or FAQPage. */
    mainEntity?: string
  },
): JsonLd {
  return node(page.type ?? 'WebPage', {
    '@id': ids.webPage(page.url),
    url: page.url,
    name: page.name,
    description: page.description,
    inLanguage: site.language,
    isPartOf: ref(ids.website(site)),
    publisher: ref(ids.organization(site)),
    primaryImageOfPage: page.image
      ? node('ImageObject', { url: page.image })
      : undefined,
    datePublished: page.published,
    dateModified: page.modified,
    breadcrumb: page.hasBreadcrumb ? ref(ids.breadcrumb(page.url)) : undefined,
    about: page.about ? ref(page.about) : undefined,
    mainEntity: page.mainEntity ? ref(page.mainEntity) : undefined,
  })
}

export function breadcrumbList(
  pageUrl: string,
  items: Array<{ name: string; url: string }>,
): JsonLd {
  return node('BreadcrumbList', {
    '@id': ids.breadcrumb(pageUrl),
    itemListElement: items.map((item, i) =>
      node('ListItem', { position: i + 1, name: item.name, item: item.url }),
    ),
  })
}

/** The open-source product itself: what the sites are about. */
export function softwareApplication(
  site: SeoSite,
  extra: {
    screenshot?: Array<string>
    featureList?: Array<string>
    video?: JsonObject
  } = {},
): JsonLd {
  const p = site.product
  return node('SoftwareApplication', {
    '@id': ids.software(site),
    name: p.name,
    alternateName: p.alternateName,
    description: p.description,
    url: p.url,
    applicationCategory: p.applicationCategory,
    applicationSubCategory: p.applicationSubCategory,
    operatingSystem: p.operatingSystem,
    softwareRequirements: p.softwareRequirements,
    license: p.license,
    isAccessibleForFree: true,
    offers: node('Offer', { price: '0', priceCurrency: 'USD' }),
    downloadUrl: p.repository,
    installUrl: p.installUrl,
    softwareHelp: p.docs ? node('CreativeWork', { url: p.docs }) : undefined,
    publisher: ref(ids.organization(site)),
    author: ref(ids.organization(site)),
    image: extra.screenshot?.[0],
    screenshot: extra.screenshot,
    featureList: extra.featureList,
    video: extra.video,
  })
}

/** The public source repository. */
export function softwareSourceCode(site: SeoSite): JsonLd {
  const p = site.product
  return node('SoftwareSourceCode', {
    '@id': idFor(site.organization.url, 'source'),
    name: `${p.name} source code`,
    codeRepository: p.repository,
    programmingLanguage: p.programmingLanguage,
    runtimePlatform: p.runtimePlatform,
    license: p.license,
    targetProduct: ref(ids.software(site)),
    author: ref(ids.organization(site)),
  })
}

export function faqPage(
  pageUrl: string,
  questions: Array<{ question: string; answer: string }>,
): JsonLd {
  return node('FAQPage', {
    '@id': ids.faq(pageUrl),
    mainEntity: questions.map((q) =>
      node('Question', {
        name: q.question,
        acceptedAnswer: node('Answer', { text: q.answer }),
      }),
    ),
  })
}

export function videoObject(video: {
  /** The page the video is on. */
  url: string
  name: string
  description: string
  thumbnailUrl: string
  contentUrl: string
  uploadDate: string
  /** ISO 8601 duration, such as `PT80S`. */
  duration?: string
  /** A player URL, only if the video can be embedded on its own. */
  embedUrl?: string
}): JsonLd {
  return node('VideoObject', {
    '@id': ids.video(video.url),
    name: video.name,
    description: video.description,
    thumbnailUrl: video.thumbnailUrl,
    contentUrl: video.contentUrl,
    uploadDate: video.uploadDate,
    duration: video.duration,
    embedUrl: video.embedUrl,
  })
}

/** A documentation page. */
export function techArticle(
  site: SeoSite,
  article: {
    url: string
    headline: string
    description: string
    section?: string
    image?: string
    published?: string
    modified?: string
    proficiencyLevel?: 'Beginner' | 'Expert'
    keywords?: Array<string>
  },
): JsonLd {
  return node('TechArticle', {
    '@id': `${article.url}#article`,
    headline: article.headline,
    description: article.description,
    url: article.url,
    mainEntityOfPage: ref(ids.webPage(article.url)),
    isPartOf: ref(ids.website(site)),
    inLanguage: site.language,
    articleSection: article.section,
    image: article.image,
    datePublished: article.published,
    dateModified: article.modified,
    proficiencyLevel: article.proficiencyLevel,
    keywords: article.keywords?.join(', '),
    author: ref(ids.organization(site)),
    publisher: ref(ids.organization(site)),
    about: ref(ids.software(site)),
  })
}

/** Step-by-step instructions, such as a guide or quickstart. */
export function howTo(
  pageUrl: string,
  guide: {
    name: string
    description: string
    totalTime?: string
    /** `url` links a step to its own page; `anchor` to a heading here. */
    steps: Array<{ name: string; text?: string; url?: string; anchor?: string }>
  },
): JsonLd {
  return node('HowTo', {
    '@id': ids.howTo(pageUrl),
    name: guide.name,
    description: guide.description,
    totalTime: guide.totalTime,
    step: guide.steps.map((s, i) =>
      node('HowToStep', {
        position: i + 1,
        name: s.name,
        text: s.text ?? s.name,
        url: s.url ?? (s.anchor ? `${pageUrl}#${s.anchor}` : undefined),
      }),
    ),
  })
}

/** An ordered list of links, such as the sections of a hub page. */
export function itemList(
  pageUrl: string,
  list: {
    name: string
    items: Array<{ name: string; url: string; description?: string }>
  },
): JsonLd {
  return node('ItemList', {
    '@id': ids.itemList(pageUrl),
    name: list.name,
    numberOfItems: list.items.length,
    itemListElement: list.items.map((item, i) =>
      node('ListItem', {
        position: i + 1,
        name: item.name,
        url: item.url,
        description: item.description,
      }),
    ),
  })
}
