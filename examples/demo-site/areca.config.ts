import { defineSiteContent } from '@areca-cms/site-sdk'

export default defineSiteContent({
  siteKey: 'demo-app-areca',
  // English is the main language (the fallback). Dutch is served under /nl.
  // Keep in step with project.inlang/settings.json and src/lib/locale-routes.ts.
  languages: { main: 'en', all: ['en', 'nl'] },
  i18n: { paraglide: './src/paraglide/runtime.js' },
  assets: {
    download: true,
    dir: 'public/areca',
  },
  collections: {
    articles: {
      route: '/journal/$slug',
      // Dutch journal pages live under /nl/journaal/<slug> (see locale-routes.ts).
      routes: { nl: '/journaal/$slug' },
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
      routes: { nl: '/koffie/$slug' },
      label: 'Coffees',
      fields: [
        // The product name is the same in every language.
        { key: 'name', label: 'Name', type: 'text', required: true, translatable: false },
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
        // Prices are the same in every language.
        { key: 'price', label: 'Price per 250 g (EUR)', type: 'number', translatable: false },
        { key: 'limited', label: 'Limited release', type: 'boolean' },
        { key: 'harvestDate', label: 'Harvest date', type: 'date' },
        { key: 'image', label: 'Image', type: 'image' },
        { key: 'description', label: 'Description', type: 'richtext' },
        // Shop links point at the same shop in every language.
        { key: 'shopUrl', label: 'Shop link', type: 'url', translatable: false },
      ],
    },
    authors: {
      route: '/team/$slug',
      label: 'Team',
      fields: [
        { key: 'name', label: 'Name', type: 'text', required: true, translatable: false },
        { key: 'slug', label: 'Slug', type: 'slug', required: true },
        { key: 'role', label: 'Role', type: 'text' },
        { key: 'bio', label: 'Bio', type: 'textarea' },
        { key: 'portrait', label: 'Portrait', type: 'image' },
      ],
    },
  },
  globals: {
    companyInfo: {
      label: 'Company info',
      fields: [
        { key: 'name', label: 'Name', type: 'text', required: true, translatable: false },
        { key: 'tagline', label: 'Tagline', type: 'textarea' },
        { key: 'address', label: 'Address', type: 'textarea', group: 'Contact' },
        // Contact details are the same in every language.
        { key: 'email', label: 'Email', type: 'text', group: 'Contact', translatable: false },
        { key: 'phone', label: 'Phone', type: 'text', group: 'Contact', translatable: false },
        { key: 'instagramUrl', label: 'Instagram', type: 'url', group: 'Contact', translatable: false },
        { key: 'foundedYear', label: 'Founded', type: 'number' },
      ],
    },
    homePage: {
      label: 'Home page',
      seo: true,
      previewPath: '/',
      fields: [
        { key: 'heroEyebrow', label: 'Hero eyebrow', type: 'text', required: true },
        { key: 'heroIntro', label: 'Hero intro', type: 'textarea', required: true },
        {
          key: 'featuredCoffee',
          label: 'Featured coffee',
          type: 'reference',
          collection: 'coffees',
        },
      ],
    },
    aboutPage: {
      label: 'About page',
      seo: true,
      previewPath: '/about',
      fields: [
        { key: 'heading', label: 'Heading', type: 'text', required: true },
        { key: 'body', label: 'Body', type: 'richtext', required: true },
        { key: 'image', label: 'Image', type: 'image' },
        { key: 'foundedYear', label: 'Founded', type: 'number', group: 'Numbers' },
        { key: 'roasterCapacityKg', label: 'Roaster capacity (kg)', type: 'number', group: 'Numbers' },
        { key: 'originsCount', label: 'Origins bought from', type: 'number', group: 'Numbers' },
      ],
    },
  },
})
