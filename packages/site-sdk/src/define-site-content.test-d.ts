import { assertType, describe, it } from 'vitest'
import { defineSiteContent } from './index.js'
import type { SiteContentConfig } from './index.js'

/*
 * Negative cases put the whole `defineSiteContent` call on the line under the
 * directive, so the error is caught wherever the implementation reports it
 * inside the call.
 */

describe('defineSiteContent: valid configs', () => {
  it('accepts a full config and stays assignable to SiteContentConfig', () => {
    const config = defineSiteContent({
      siteKey: 'acme',
      collections: {
        authors: {
          route: '/authors/$slug',
          fields: [
            { key: 'slug', label: 'Slug', type: 'slug', required: true },
            { key: 'name', label: 'Name', type: 'text', required: true },
          ],
        },
        blogPosts: {
          route: '/blog/$slug',
          label: 'Blog posts',
          fields: [
            { key: 'slug', label: 'Slug', type: 'slug', required: true },
            { key: 'category', label: 'Category', type: 'select', options: ['news', 'guides'] },
            { key: 'author', label: 'Author', type: 'reference', collection: 'authors' },
            { key: 'starts', label: 'Starts', type: 'date' },
            { key: 'ends', label: 'Ends', type: 'datetime', after: 'starts' },
          ],
        },
      },
      assets: { download: true },
    })
    assertType<SiteContentConfig>(config)
  })

  it('accepts every one of the twelve field types', () => {
    const config = defineSiteContent({
      siteKey: 'acme',
      collections: {
        all: {
          route: '/$slug',
          fields: [
            { key: 'text', label: 'Text', type: 'text' },
            { key: 'textarea', label: 'Textarea', type: 'textarea' },
            { key: 'richtext', label: 'Rich text', type: 'richtext' },
            { key: 'image', label: 'Image', type: 'image' },
            { key: 'date', label: 'Date', type: 'date' },
            { key: 'datetime', label: 'Datetime', type: 'datetime' },
            { key: 'select', label: 'Select', type: 'select' },
            { key: 'slug', label: 'Slug', type: 'slug', required: true },
            { key: 'boolean', label: 'Boolean', type: 'boolean' },
            { key: 'number', label: 'Number', type: 'number' },
            { key: 'url', label: 'Url', type: 'url' },
          ],
        },
      },
    })
    assertType<SiteContentConfig>(config)
  })
})

describe('defineSiteContent: options', () => {
  it('rejects options on a text field', () => {
    // @ts-expect-error options are only allowed on select fields
    defineSiteContent({ siteKey: 's', collections: { posts: { route: '/p/$slug', fields: [{ key: 'title', label: 'T', type: 'text', options: ['a'] }] } } })
  })
})

describe('defineSiteContent: reference collection', () => {
  it('rejects a reference without a collection', () => {
    // @ts-expect-error reference fields require a collection
    defineSiteContent({ siteKey: 's', collections: { posts: { route: '/p/$slug', fields: [{ key: 'author', label: 'A', type: 'reference' }] } } })
  })

  it('rejects a collection key that does not exist in this config', () => {
    // @ts-expect-error there is no collection called missing
    defineSiteContent({ siteKey: 's', collections: { posts: { route: '/p/$slug', fields: [{ key: 'author', label: 'A', type: 'reference', collection: 'missing' }] } } })
  })

  it('accepts a collection key that exists in this config', () => {
    defineSiteContent({ siteKey: 's', collections: { authors: { route: '/a/$slug', fields: [] }, posts: { route: '/p/$slug', fields: [{ key: 'author', label: 'A', type: 'reference', collection: 'authors' }] } } })
  })

  it('rejects collection on a non-reference field', () => {
    // @ts-expect-error collection is only allowed on reference fields
    defineSiteContent({ siteKey: 's', collections: { authors: { route: '/a/$slug', fields: [] }, posts: { route: '/p/$slug', fields: [{ key: 'title', label: 'T', type: 'text', collection: 'authors' }] } } })
  })
})

describe('defineSiteContent: after', () => {
  it('accepts a datetime after a sibling date key', () => {
    defineSiteContent({ siteKey: 's', collections: { events: { route: '/e/$slug', fields: [{ key: 'starts', label: 'Starts', type: 'date' }, { key: 'ends', label: 'Ends', type: 'datetime', after: 'starts' }] } } })
  })

  it('rejects after pointing to a text field', () => {
    // @ts-expect-error after must point to a date or datetime field
    defineSiteContent({ siteKey: 's', collections: { events: { route: '/e/$slug', fields: [{ key: 'title', label: 'Title', type: 'text' }, { key: 'ends', label: 'Ends', type: 'date', after: 'title' }] } } })
  })

  it('rejects after pointing to a key that does not exist', () => {
    // @ts-expect-error there is no field called nope
    defineSiteContent({ siteKey: 's', collections: { events: { route: '/e/$slug', fields: [{ key: 'ends', label: 'Ends', type: 'date', after: 'nope' }] } } })
  })

  it('rejects after on a text field', () => {
    // @ts-expect-error after is only allowed on date and datetime fields
    defineSiteContent({ siteKey: 's', collections: { events: { route: '/e/$slug', fields: [{ key: 'starts', label: 'Starts', type: 'date' }, { key: 'title', label: 'Title', type: 'text', after: 'starts' }] } } })
  })

  it('rejects after pointing to a date field of another collection', () => {
    // @ts-expect-error after must point to a field of the same collection
    defineSiteContent({ siteKey: 's', collections: { other: { route: '/o/$slug', fields: [{ key: 'starts', label: 'Starts', type: 'date' }] }, events: { route: '/e/$slug', fields: [{ key: 'ends', label: 'Ends', type: 'date', after: 'starts' }] } } })
  })
})

describe('defineSiteContent: route', () => {
  it('accepts a route containing $slug', () => {
    defineSiteContent({ siteKey: 's', collections: { posts: { route: '/blog/$slug', fields: [] } } })
  })

  it('rejects a route without $slug', () => {
    // @ts-expect-error the route must contain $slug
    defineSiteContent({ siteKey: 's', collections: { posts: { route: '/blog', fields: [] } } })
  })
})

describe('defineSiteContent: field type', () => {
  it('rejects a field type that does not exist', () => {
    // @ts-expect-error nope is not a field type
    defineSiteContent({ siteKey: 's', collections: { posts: { route: '/p/$slug', fields: [{ key: 'title', label: 'T', type: 'nope' }] } } })
  })
})

describe('defineSiteContent: globals', () => {
  it('accepts globals next to collections and stays assignable to SiteContentConfig', () => {
    const config = defineSiteContent({
      siteKey: 'acme',
      collections: {
        authors: {
          route: '/authors/$slug',
          fields: [{ key: 'slug', label: 'Slug', type: 'slug', required: true }],
        },
      },
      globals: {
        companyInfo: {
          label: 'Company info',
          fields: [
            { key: 'email', label: 'Email', type: 'text', required: true, group: 'Contact' },
            { key: 'featured', label: 'Featured', type: 'reference', collection: 'authors' },
            { key: 'opens', label: 'Opens', type: 'date' },
            { key: 'closes', label: 'Closes', type: 'datetime', after: 'opens' },
            { key: 'plan', label: 'Plan', type: 'select', options: ['basic', 'pro'] },
          ],
        },
        homePage: {
          label: 'Home page',
          seo: true,
          previewPath: '/',
          fields: [{ key: 'heroTitle', label: 'Hero title', type: 'text' }],
        },
      },
    })
    assertType<SiteContentConfig>(config)
  })

  it('accepts every field type except slug in a global', () => {
    const config = defineSiteContent({
      siteKey: 'acme',
      collections: {
        authors: { route: '/authors/$slug', fields: [] },
      },
      globals: {
        all: {
          fields: [
            { key: 'text', label: 'Text', type: 'text', group: 'G' },
            { key: 'textarea', label: 'Textarea', type: 'textarea', group: 'G' },
            { key: 'richtext', label: 'Rich text', type: 'richtext', group: 'G' },
            { key: 'image', label: 'Image', type: 'image', group: 'G' },
            { key: 'date', label: 'Date', type: 'date', group: 'G' },
            { key: 'datetime', label: 'Datetime', type: 'datetime', group: 'G' },
            { key: 'select', label: 'Select', type: 'select', group: 'G' },
            { key: 'boolean', label: 'Boolean', type: 'boolean', group: 'G' },
            { key: 'number', label: 'Number', type: 'number', group: 'G' },
            { key: 'url', label: 'Url', type: 'url', group: 'G' },
            { key: 'reference', label: 'Reference', type: 'reference', collection: 'authors' },
          ],
        },
      },
    })
    assertType<SiteContentConfig>(config)
  })
})

describe('defineSiteContent: globals rejections', () => {
  it('rejects slug in a global', () => {
    // @ts-expect-error slug fields are not allowed in globals
    defineSiteContent({ siteKey: 's', collections: {}, globals: { info: { fields: [{ key: 'slug', label: 'Slug', type: 'slug', required: true }] } } })
  })

  it('rejects a reference in a global to a key that is not a collection', () => {
    // @ts-expect-error a global reference must target a collection key
    defineSiteContent({ siteKey: 's', collections: { authors: { route: '/a/$slug', fields: [] } }, globals: { info: { fields: [{ key: 'author', label: 'A', type: 'reference', collection: 'missing' }] } } })
  })

  it('rejects a reference in a global to another global', () => {
    // @ts-expect-error globals cannot be reference targets
    defineSiteContent({ siteKey: 's', collections: { authors: { route: '/a/$slug', fields: [] } }, globals: { info: { fields: [] }, page: { fields: [{ key: 'info', label: 'I', type: 'reference', collection: 'info' }] } } })
  })

  it('rejects a collection reference to a global key', () => {
    // @ts-expect-error collections may not reference globals
    defineSiteContent({ siteKey: 's', collections: { posts: { route: '/p/$slug', fields: [{ key: 'info', label: 'I', type: 'reference', collection: 'info' }] } }, globals: { info: { fields: [] } } })
  })

  it('rejects after in a global pointing to a text field', () => {
    // @ts-expect-error after must name a date field of the same global
    defineSiteContent({ siteKey: 's', collections: {}, globals: { info: { fields: [{ key: 'title', label: 'Title', type: 'text' }, { key: 'ends', label: 'Ends', type: 'date', after: 'title' }] } } })
  })

  it('rejects after in a global pointing to a date field of another global', () => {
    // @ts-expect-error after must point to a field of the same global
    defineSiteContent({ siteKey: 's', collections: {}, globals: { other: { fields: [{ key: 'starts', label: 'Starts', type: 'date' }] }, info: { fields: [{ key: 'ends', label: 'Ends', type: 'date', after: 'starts' }] } } })
  })

  it('accepts after pointing to a date field of the same global', () => {
    defineSiteContent({ siteKey: 's', collections: {}, globals: { info: { fields: [{ key: 'starts', label: 'Starts', type: 'date' }, { key: 'ends', label: 'Ends', type: 'date', after: 'starts' }] } } })
  })

  it('rejects group on a collection field', () => {
    // @ts-expect-error group is only allowed on global fields
    defineSiteContent({ siteKey: 's', collections: { posts: { route: '/p/$slug', fields: [{ key: 'title', label: 'T', type: 'text', group: 'Main' }] } } })
  })

  it('rejects an unknown field type in a global', () => {
    // @ts-expect-error nope is not a field type
    defineSiteContent({ siteKey: 's', collections: {}, globals: { info: { fields: [{ key: 'title', label: 'T', type: 'nope' }] } } })
  })

  it('rejects options on a text field in a global', () => {
    // @ts-expect-error options are only allowed on select fields
    defineSiteContent({ siteKey: 's', collections: {}, globals: { info: { fields: [{ key: 'title', label: 'T', type: 'text', options: ['a'] }] } } })
  })
})
