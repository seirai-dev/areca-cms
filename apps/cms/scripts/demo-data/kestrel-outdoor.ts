import type { Field } from '#/lib/types'

import type { DemoClient } from './types'

const authorFields: Field[] = [
  { key: 'name', label: 'Name', type: 'text', required: true },
  { key: 'slug', label: 'Slug', type: 'slug', required: true },
  { key: 'bio', label: 'Bio', type: 'textarea' },
]

const guideFields: Field[] = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'slug', label: 'Slug', type: 'slug', required: true },
  { key: 'excerpt', label: 'Excerpt', type: 'textarea' },
  { key: 'coverImage', label: 'Cover image', type: 'image' },
  { key: 'body', label: 'Body', type: 'richtext', required: true },
  { key: 'author', label: 'Author', type: 'reference', collection: 'authors' },
]

export const kestrelOutdoor: DemoClient = {
  slug: 'kestrel-outdoor',
  name: 'Kestrel Outdoor Gear',
  domain: 'kestreloutdoor.example',
  owner: { name: 'Ben Hartley', email: 'ben@kestreloutdoor.example' },
  editor: { name: 'Leah Osei', email: 'leah@kestreloutdoor.example' },
  site: { name: 'kestreloutdoor.example', slug: 'kestrel-outdoor' },
  images: [
    {
      key: 'alpineTent',
      picsumId: 1036,
      alt: 'Tent pitched in deep snow below a mountain range',
    },
    {
      key: 'layering',
      picsumId: 1044,
      alt: 'Misty forest valley with a person standing above a rushing river',
    },
    {
      key: 'trailWeekend',
      picsumId: 1043,
      alt: 'Still river below granite cliffs and tall pine trees',
    },
    {
      key: 'riverCrossing',
      picsumId: 1039,
      alt: 'Waterfall cascading over green rocks into a forest gorge',
    },
  ],
  collections: [
    {
      key: 'authors',
      label: 'Authors',
      routePattern: '/authors/$slug',
      fields: authorFields,
      entries: [
        {
          slug: 'maya-lindqvist',
          status: 'live',
          data: {
            name: 'Maya Lindqvist',
            slug: 'maya-lindqvist',
            bio: 'Mountain guide and gear tester. Has pitched a tent in every month of the year, and most of them in the rain.',
          },
        },
        {
          slug: 'dev-raman',
          status: 'live',
          data: {
            name: 'Dev Raman',
            slug: 'dev-raman',
            bio: 'Runs our footwear and clothing tests. Former ski patroller, now mostly walking hills with a notebook.',
          },
        },
      ],
    },
    {
      key: 'guides',
      label: 'Guides',
      routePattern: '/guides/$slug',
      fields: guideFields,
      entries: [
        {
          slug: 'choosing-a-three-season-tent',
          status: 'live',
          data: {
            title: 'Choosing a three-season tent',
            slug: 'choosing-a-three-season-tent',
            excerpt:
              'Weight, wind and how much room you actually need. A short guide to picking a tent you will use.',
            coverImage: 'img:alpineTent',
            author: 'ref:authors:maya-lindqvist',
            body: [
              'A three-season tent is built for spring, summer and autumn. It should handle wind and rain without making you sweat through the night.',
              '## Three things to check',
              '- **Pole design.** Crossed poles stand up to wind better than a single ridge pole.',
              '- **Vestibule space.** You want somewhere dry to leave boots.',
              '- **Packed weight.** Compare the weight with the fly and pegs included.',
              'Try pitching the tent in your garden before you go. Five minutes in the rain will tell you more than any spec sheet.',
            ].join('\n\n'),
          },
          seo: {
            title: 'Choosing a three-season tent | Kestrel Outdoor Gear',
            description:
              'How to choose a three-season tent: pole design, vestibule space and packed weight, with a test-pitch checklist.',
            focusKeyphrase: 'three season tent',
          },
        },
        {
          slug: 'layering-for-wet-hill-walks',
          status: 'ready',
          data: {
            title: 'Layering for wet hill walks',
            slug: 'layering-for-wet-hill-walks',
            excerpt:
              'A base, a mid layer and one waterproof you trust. Why it works better than one thick jacket.',
            coverImage: 'img:layering',
            author: 'ref:authors:dev-raman',
            body: [
              'On a wet hill walk you produce heat and moisture at the same time. Layers let you manage both by adding or removing one piece at a time.',
              '## A simple system',
              '1. A base layer that moves sweat away from the skin.',
              '2. A light insulated mid layer for standing still.',
              '3. A waterproof shell with taped seams.',
            ].join('\n\n'),
          },
          seo: {
            title: 'Layering for wet hill walks | Kestrel Outdoor Gear',
            description:
              'A three-layer system for wet hill walks: a base layer, a light mid layer and a taped waterproof shell.',
            focusKeyphrase: 'layering for hill walking',
          },
        },
        {
          slug: 'planning-a-river-crossing',
          status: 'draft',
          data: {
            title: 'Planning a river crossing',
            slug: 'planning-a-river-crossing',
            excerpt:
              'Check the flow, scout the line and never unbuckle your pack in the water.',
            coverImage: 'img:riverCrossing',
            author: 'ref:authors:maya-lindqvist',
            body: 'Draft: safety checklist to be reviewed by the guides team before publishing.',
          },
        },
      ],
    },
  ],
  global: {
    key: 'company',
    label: 'Shop info',
    fields: [
      { key: 'name', label: 'Shop name', type: 'text', required: true },
      { key: 'tagline', label: 'Tagline', type: 'text' },
      { key: 'phone', label: 'Phone', type: 'text' },
      { key: 'address', label: 'Address', type: 'textarea' },
    ],
    values: {
      name: 'Kestrel Outdoor Gear',
      tagline: 'Equipment we have tested on our own hills.',
      phone: '020 7946 0553',
      address: '22 Quarry Street, Lowhaven LH3 8CD',
    },
  },
}
