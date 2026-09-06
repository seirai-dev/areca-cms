import { defineSiteContent } from '@areca/site-sdk'

export const siteContent = defineSiteContent({
  siteKey: 'demo',
  collections: {
    articles: {
      route: '/articles/$slug',
      label: 'Articles',
      fields: [
        { key: 'title', label: 'Title', type: 'text', required: true },
        { key: 'slug', label: 'Slug', type: 'slug', required: true },
      ],
    },
  },
})
