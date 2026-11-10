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
  name: 'Areca CMS',
  url: 'https://arecacms.com',
  description:
    'Areca CMS is the open-source, self-hosted CMS for agencies. Clients write and approve; every release is a frozen snapshot your site pulls at build time.',
  language: 'en',
  ogLocale: 'en_US',
  titleTemplate: '%s · Areca CMS',
  image: {
    src: '/og.png',
    width: 1200,
    height: 630,
    alt: 'Areca CMS: your website, in your hands. The open-source, self-hosted CMS for agencies.',
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
    disallow: [],
  },
  llms: {
    summary:
      'Areca CMS is an open-source (MIT), self-hosted CMS for agencies that run websites for their clients. Clients write and approve content; Go live freezes it into an immutable snapshot that the website pulls at build time, so published pages never call the CMS.',
    details: [
      'Areca is free with no paid edition. It runs on Node, PostgreSQL, Redis and S3-compatible storage (one Docker Compose file starts them all) and deploys client sites through Dokploy or Cloudflare Pages and Workers.',
      'For setup, the SDK and operations, read the documentation; its own llms.txt lists every page as Markdown.',
    ],
    sections: [
      {
        title: 'Documentation',
        links: [
          {
            title: 'Docs llms.txt',
            url: 'https://docs.arecacms.com/llms.txt',
            description: 'Every documentation page, as Markdown links.',
          },
          {
            title: 'Introduction',
            url: 'https://docs.arecacms.com/docs/index.md',
            description: 'What Areca is and how publishing works.',
          },
          {
            title: 'Quickstart',
            url: 'https://docs.arecacms.com/docs/quickstart.md',
            description: 'From an empty CMS to a first live release.',
          },
          {
            title: 'Docker quickstart',
            url: 'https://docs.arecacms.com/docs/self-hosting/docker-quickstart.md',
            description: 'Run Areca on your own server.',
          },
          {
            title: 'Site SDK',
            url: 'https://docs.arecacms.com/docs/sdk.md',
            description:
              'Connect a website: define content, pull snapshots, render rich text.',
          },
        ],
      },
      {
        title: 'Optional',
        links: [
          {
            title: 'Full documentation',
            url: 'https://docs.arecacms.com/llms-full.txt',
            description: 'Every documentation page in one Markdown file.',
          },
          {
            title: 'Source code',
            url: 'https://github.com/seirai-dev/areca-cms',
            description: 'The MIT-licensed repository on GitHub.',
          },
          {
            title: 'Live demo site',
            url: 'https://demo.arecacms.com',
            description: 'A website built with Areca.',
          },
        ],
      },
    ],
  },
}
