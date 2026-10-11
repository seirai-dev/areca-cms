import { defineSiteContent } from '@areca-cms/site-sdk'

export default defineSiteContent({
  siteKey: 'demo-app-areca',
  assets: {
    download: true,
    dir: 'public/areca',
  },
  collections: {
    articles: {
      route: '/journal/$slug',
      label: 'Journal',
      fields: [
        { key: 'title', label: 'Title', type: 'text', required: true },
        { key: 'slug', label: 'Slug', type: 'slug', required: true },
        { key: 'excerpt', label: 'Excerpt', type: 'textarea' },
        { key: 'body', label: 'Body', type: 'richtext', required: true },
        { key: 'heroImage', label: 'Hero image', type: 'image' },
        {
          key: 'category',
          label: 'Category',
          type: 'select',
          options: ['origin-stories', 'brewing', 'roastery-news', 'sustainability'],
        },
        {
          key: 'author',
          label: 'Author',
          type: 'reference',
          collection: 'authors',
        },
        {
          key: 'featuredCoffee',
          label: 'Featured coffee',
          type: 'reference',
          collection: 'coffees',
        },
        { key: 'publishedAt', label: 'Published at', type: 'datetime' },
      ],
    },
    coffees: {
      route: '/coffees/$slug',
      label: 'Coffees',
      fields: [
        { key: 'name', label: 'Name', type: 'text', required: true },
        { key: 'slug', label: 'Slug', type: 'slug', required: true },
        { key: 'origin', label: 'Country of origin', type: 'text', required: true },
        { key: 'region', label: 'Region', type: 'text' },
        { key: 'producer', label: 'Producer', type: 'text' },
        {
          key: 'process',
          label: 'Process',
          type: 'select',
          options: ['washed', 'natural', 'honey', 'anaerobic'],
        },
        {
          key: 'roastLevel',
          label: 'Roast level',
          type: 'select',
          options: ['light', 'medium', 'medium-dark', 'dark'],
        },
        {
          key: 'tastingNotes',
          label: 'Tasting notes',
          type: 'textarea',
          description: 'Comma-separated, e.g. "blueberry, jasmine, cacao nib".',
        },
        {
          key: 'altitude',
          label: 'Altitude (m above sea level)',
          type: 'number',
        },
        { key: 'price', label: 'Price per 250 g (EUR)', type: 'number' },
        { key: 'limited', label: 'Limited release', type: 'boolean' },
        { key: 'harvestDate', label: 'Harvest date', type: 'date' },
        { key: 'image', label: 'Image', type: 'image' },
        { key: 'description', label: 'Description', type: 'richtext' },
        { key: 'shopUrl', label: 'Shop link', type: 'url' },
      ],
    },
    authors: {
      route: '/team/$slug',
      label: 'Team',
      fields: [
        { key: 'name', label: 'Name', type: 'text', required: true },
        { key: 'slug', label: 'Slug', type: 'slug', required: true },
        { key: 'role', label: 'Role', type: 'text' },
        { key: 'bio', label: 'Bio', type: 'textarea' },
        { key: 'portrait', label: 'Portrait', type: 'image' },
      ],
    },
  },
})
