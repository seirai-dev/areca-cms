import type { Field } from '#/lib/types'

import type { DemoClient } from './types'

const projectFields: Field[] = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'slug', label: 'Slug', type: 'slug', required: true },
  { key: 'location', label: 'Location', type: 'text' },
  { key: 'year', label: 'Year', type: 'number' },
  { key: 'coverImage', label: 'Cover image', type: 'image' },
  { key: 'body', label: 'Description', type: 'richtext', required: true },
]

const journalFields: Field[] = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'slug', label: 'Slug', type: 'slug', required: true },
  { key: 'excerpt', label: 'Excerpt', type: 'textarea' },
  { key: 'coverImage', label: 'Cover image', type: 'image' },
  { key: 'body', label: 'Body', type: 'richtext', required: true },
  { key: 'publishedAt', label: 'Published at', type: 'datetime' },
]

export const fieldnoteArchitects: DemoClient = {
  slug: 'fieldnote-architects',
  name: 'Fieldnote Architects',
  domain: 'fieldnote.studio',
  owner: { name: 'Jonas Reid', email: 'jonas@fieldnote.studio' },
  editor: { name: 'Ines Caldera', email: 'ines@fieldnote.studio' },
  site: { name: 'fieldnote.studio', slug: 'fieldnote' },
  images: [
    {
      key: 'harbourLofts',
      picsumId: 1048,
      alt: 'Looking up at a symmetrical tower of glass and steel',
    },
    {
      key: 'glassLibrary',
      picsumId: 1031,
      alt: 'Looking up at a tall glass facade against a grey sky',
    },
    {
      key: 'pavilion',
      picsumId: 1076,
      alt: 'Pyramid-shaped building with a steel lattice facade',
    },
    {
      key: 'concreteChapel',
      picsumId: 1054,
      alt: 'Weathered concrete facade with small windows',
    },
    {
      key: 'journalModel',
      picsumId: 60,
      alt: 'Overhead view of a desk with a monitor, keyboard, tablet and graphics tablet',
    },
  ],
  collections: [
    {
      key: 'projects',
      label: 'Projects',
      routePattern: '/projects/$slug',
      fields: projectFields,
      entries: [
        {
          slug: 'harbour-lofts',
          status: 'live',
          data: {
            title: 'Harbour Lofts',
            slug: 'harbour-lofts',
            location: 'Lowhaven, Quay Road',
            year: 2024,
            coverImage: 'img:harbourLofts',
            body: [
              'Twelve apartments on a former customs warehouse. We kept the brick piers and the timber roof trusses, and added a steel-framed stair that brings daylight to the middle of the plan.',
              '![Looking up at a tall grey tower against pale sky](img:harbourLofts)',
              '## Materials',
              '- Reclaimed brick from the original warehouse',
              '- Oiled oak for the stair and balconies',
              '- Triple-glazed timber windows on the quay side',
            ].join('\n\n'),
          },
          seo: {
            title: 'Harbour Lofts, Lowhaven | Fieldnote Architects',
            description:
              'Twelve apartments in a converted customs warehouse on Lowhaven quay, with reclaimed brick and a daylit steel stair.',
            focusKeyphrase: 'warehouse conversion',
          },
        },
        {
          slug: 'glasshouse-library',
          status: 'live',
          data: {
            title: 'Glasshouse Library',
            slug: 'glasshouse-library',
            location: 'Millbrook',
            year: 2025,
            coverImage: 'img:glassLibrary',
            body: [
              'A public library built around a single glass hall. The reading rooms sit on the north side, so the hall gets the sun without the glare on the screens.',
              'The timber shelving is designed to be moved, so the library can change its layout as the collection does.',
            ].join('\n\n'),
          },
          seo: {
            title: 'Glasshouse Library, Millbrook | Fieldnote Architects',
            description:
              'A public library with a glass hall, north-facing reading rooms and movable timber shelving, by Fieldnote Architects.',
            focusKeyphrase: 'public library architecture',
          },
        },
        {
          slug: 'pavilion-on-the-ridge',
          status: 'ready',
          data: {
            title: 'Pavilion on the Ridge',
            slug: 'pavilion-on-the-ridge',
            location: 'Gallows Ridge',
            year: 2026,
            coverImage: 'img:pavilion',
            body: [
              'A timber-and-steel pavilion for a walking trail on the ridge. It is open on three sides and built to stand through the wind.',
            ].join('\n\n'),
          },
          seo: {
            title: 'Pavilion on the Ridge | Fieldnote Architects',
            description:
              'A timber and steel pavilion on Gallows Ridge, open on three sides and built to stand up to strong winds.',
            focusKeyphrase: 'ridge pavilion',
          },
        },
        {
          slug: 'concrete-chapel',
          status: 'draft',
          data: {
            title: 'Concrete Chapel',
            slug: 'concrete-chapel',
            location: 'Mill Road',
            year: 2026,
            coverImage: 'img:concreteChapel',
            body: 'Competition entry, not yet cleared for publication.',
          },
        },
      ],
    },
    {
      key: 'journal',
      label: 'Journal',
      routePattern: '/journal/$slug',
      fields: journalFields,
      entries: [
        {
          slug: 'why-we-keep-the-model-room',
          status: 'live',
          data: {
            title: 'Why we keep the model room',
            slug: 'why-we-keep-the-model-room',
            excerpt:
              'Every project starts with a table covered in card. We think that is worth keeping.',
            coverImage: 'img:journalModel',
            publishedAt: '2026-08-18T10:00:00+01:00',
            body: [
              'Our studio has a model room at the back, with one large table and a shelf of offcuts. Nobody is assigned to it.',
              'Models find problems that drawings hide, usually within the first hour of cutting card. That is why we keep the room, even when the screens are busy.',
            ].join('\n\n'),
          },
        },
        {
          slug: 'reading-a-site-before-drawing-it',
          status: 'live',
          data: {
            title: 'Reading a site before drawing it',
            slug: 'reading-a-site-before-drawing-it',
            excerpt:
              'Three site visits, one notebook, and no drawings until the third.',
            publishedAt: '2026-07-30T10:00:00+01:00',
            body: [
              'Our first visit is for walking. We note where the light falls at different times of day, where people actually cut across, and what the ground is doing after rain.',
              'Only after the third visit do we open the software. By then the drawing mostly writes itself.',
            ].join('\n\n'),
          },
        },
        {
          slug: 'notes-from-the-glasshouse-handover',
          status: 'draft',
          data: {
            title: 'Notes from the Glasshouse handover',
            slug: 'notes-from-the-glasshouse-handover',
            excerpt:
              'What the library team asked us to change after the first year.',
            body: 'Draft notes, to be finished after the one-year review.',
          },
        },
      ],
    },
  ],
  global: {
    key: 'studio',
    label: 'Studio info',
    fields: [
      { key: 'name', label: 'Studio name', type: 'text', required: true },
      { key: 'tagline', label: 'Tagline', type: 'text' },
      { key: 'email', label: 'Email', type: 'text' },
      { key: 'address', label: 'Address', type: 'textarea' },
    ],
    values: {
      name: 'Fieldnote Architects',
      tagline:
        'A small studio for buildings that are kept, repaired and reused.',
      email: 'studio@fieldnote.studio',
      address: '3 Foundry Yard, Lowhaven LH1 2AB',
    },
  },
}
