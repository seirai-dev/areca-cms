// Site facts for SEO, structured data, robots.txt, sitemap.xml and llms.txt.
// Read by the app (through ./index.ts) and by scripts/seo.mjs after the build,
// so it must stay plain data: no imports, and only TypeScript that Node can
// strip (types, no enums or namespaces).

export type SeoSite = {
  /** Site name for og:site_name and the WebSite node. */
  name: string
  /** Origin with no trailing slash. */
  url: string
  description: string
  /** BCP 47 language of the content. */
  language: string
  ogLocale: string
  /** `%s` is replaced with the page title. */
  titleTemplate: string
  /** Default link preview image, 1200×630. */
  image: { src: string; width: number; height: number; alt: string }
  organization: {
    name: string
    url: string
    logo: string
    description: string
    sameAs: Array<string>
  }
  product: {
    name: string
    alternateName?: string
    description: string
    url: string
    docs?: string
    repository: string
    installUrl?: string
    license: string
    applicationCategory: string
    applicationSubCategory?: string
    operatingSystem: string
    softwareRequirements?: string
    programmingLanguage: string
    runtimePlatform?: string
  }
  robots: {
    /** Paths no crawler should fetch. */
    disallow: Array<string>
  }
  llms: {
    /** The one-paragraph answer to "what is this site?". */
    summary: string
    /** Plain paragraphs after the summary. */
    details: Array<string>
    /** Extra link sections. `Optional` is the llms.txt name for "skippable". */
    sections: Array<{
      title: string
      links: Array<{ title: string; url: string; description?: string }>
    }>
    /** Page sections in this order; any other section follows. */
    order?: Array<string>
    /** Section for pages without a breadcrumb section. Default `Pages`. */
    fallbackSection?: string
  }
}

export const site: SeoSite = {
  name: 'Areca CMS Docs',
  url: 'https://docs.arecacms.com',
  description:
    'Documentation for Areca CMS, the open-source CMS for agency-managed websites: using the CMS, the site SDK, self-hosting and security.',
  language: 'en',
  ogLocale: 'en_US',
  titleTemplate: '%s · Areca CMS Docs',
  image: {
    src: '/og.png',
    width: 1200,
    height: 630,
    alt: 'Areca CMS, the open-source CMS for agencies',
  },
  organization: {
    name: 'Areca CMS',
    url: 'https://arecacms.com',
    logo: 'https://arecacms.com/favicon.svg',
    description:
      'Areca CMS is an MIT-licensed, self-hosted CMS for agencies that run websites for their clients.',
    sameAs: ['https://github.com/seirai-dev/areca-cms'],
  },
  product: {
    name: 'Areca CMS',
    alternateName: 'Areca',
    description:
      'An open-source, self-hosted CMS for agency-run websites. Clients write and approve; every release is an immutable snapshot the website pulls at build time.',
    url: 'https://arecacms.com',
    docs: 'https://docs.arecacms.com/docs',
    repository: 'https://github.com/seirai-dev/areca-cms',
    installUrl: 'https://docs.arecacms.com/docs/self-hosting/docker-quickstart',
    license: 'https://opensource.org/licenses/MIT',
    applicationCategory: 'DeveloperApplication',
    applicationSubCategory: 'Content management system',
    operatingSystem: 'Linux, macOS, Windows (Docker)',
    softwareRequirements: 'Docker, PostgreSQL, Redis, S3-compatible storage',
    programmingLanguage: 'TypeScript',
    runtimePlatform: 'Node.js',
  },
  robots: {
    disallow: ['/api/'],
  },
  llms: {
    summary:
      'Areca CMS is an open-source (MIT), self-hosted CMS for agencies that run websites for their clients. Editors write and approve content; Go live freezes it into an immutable snapshot that the website pulls at build time with the site SDK, so published pages never call the CMS.',
    details: [
      'Every page below is also available as Markdown: the links point at the `.md` version. The whole documentation as one file is at https://docs.arecacms.com/llms-full.txt.',
      'Product site: https://arecacms.com. Source code: https://github.com/seirai-dev/areca-cms.',
    ],
    fallbackSection: 'Get started',
    order: ['Get started', 'Guides', 'CMS guide', 'SDK & API', 'Self-hosting', 'Security'],
    sections: [
      {
        title: 'Optional',
        links: [
          {
            title: 'Full documentation',
            url: 'https://docs.arecacms.com/llms-full.txt',
            description: 'Every page in one Markdown file.',
          },
          {
            title: 'Areca CMS',
            url: 'https://arecacms.com',
            description: 'Product overview and FAQ.',
          },
        ],
      },
    ],
  },
}
