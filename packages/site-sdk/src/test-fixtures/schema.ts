/**
 * Mirrors the `schema` export that `areca pull` generates into `areca.gen.ts`
 * (docs/design/sdk-type-safety.md section 4). Keys are raw CMS keys on
 * `key`, camelCase on the object property names.
 */
export const schema = {
  blogPosts: {
    key: 'blog-posts',
    label: 'Blog posts',
    route: '/blog/$slug',
    fields: {
      /** Slug */
      slug: { key: 'slug', label: 'Slug', type: 'slug', required: true },
      /** Title — Shown as the page heading. */
      title: { key: 'title', label: 'Title', type: 'text', required: true },
      /** Cover image */
      coverImage: { key: 'cover-image', label: 'Cover image', type: 'image', required: false },
      /** Category */
      category: {
        key: 'category',
        label: 'Category',
        type: 'select',
        required: false,
        options: ['news', 'guides'],
      },
      /** Author */
      author: {
        key: 'author',
        label: 'Author',
        type: 'reference',
        required: false,
        collection: 'authors',
      },
      /** Editor */
      editor: {
        key: 'editor',
        label: 'Editor',
        type: 'reference',
        required: true,
        collection: 'authors',
      },
      /** Price */
      price: { key: 'price', label: 'Price', type: 'number', required: false },
      /** Featured */
      featured: { key: 'featured', label: 'Featured', type: 'boolean', required: true },
      /** Published on */
      publishedOn: { key: 'published-on', label: 'Published on', type: 'date', required: false },
      /** Body */
      body: { key: 'body', label: 'Body', type: 'richtext', required: true },
    },
  },
  authors: {
    key: 'authors',
    label: 'Authors',
    route: '/authors/$slug',
    fields: {
      /** Slug */
      slug: { key: 'slug', label: 'Slug', type: 'slug', required: true },
      /** Name */
      name: { key: 'name', label: 'Name', type: 'text', required: true },
      /** Bio */
      bio: { key: 'bio', label: 'Bio', type: 'textarea', required: false },
      /** Website */
      website: { key: 'website', label: 'Website', type: 'url', required: false },
    },
  },
  pages: {
    key: 'pages',
    label: 'Pages',
    route: '/$slug',
    fields: {
      /** Slug */
      slug: { key: 'slug', label: 'Slug', type: 'slug', required: true },
    },
  },
} as const
