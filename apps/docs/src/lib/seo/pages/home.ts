// SEO for the docs home page (src/routes/index.tsx).
import { sections } from '@/lib/home-sections'
import { ids, itemList, seo, site, softwareApplication, url } from '..'
import type { PageSeo } from '..'

const path = '/'

export const homeSeo: PageSeo = {
  path,
  title: 'Areca CMS Docs: the open-source CMS for agencies',
  absoluteTitle: true,
  description:
    'Guides and reference for Areca CMS: write and go live in the CMS, connect a website with the site SDK, self-host with Docker, and secure every site.',
  pageType: 'CollectionPage',
  about: ids.software(site),
  mainEntity: ids.itemList(url(path)),
  schema: [
    // Names the product the whole docs graph is about (WebSite.about).
    softwareApplication(site),
    itemList(url(path), {
      name: 'Areca CMS documentation sections',
      items: sections.map((s) => ({
        name: s.title,
        url: url(s.href),
        description: s.description,
      })),
    }),
  ],
}

export const homeHead = () => seo(homeSeo)
