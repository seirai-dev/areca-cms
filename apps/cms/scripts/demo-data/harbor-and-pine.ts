import type { Field } from '#/lib/types'

import type { DemoClient } from './types'

const postFields: Field[] = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'slug', label: 'Slug', type: 'slug', required: true },
  { key: 'excerpt', label: 'Excerpt', type: 'textarea' },
  { key: 'coverImage', label: 'Cover image', type: 'image' },
  { key: 'body', label: 'Body', type: 'richtext', required: true },
  { key: 'publishedAt', label: 'Published at', type: 'datetime' },
  {
    key: 'category',
    label: 'Category',
    type: 'select',
    options: ['news', 'recipes', 'behind-the-scenes'],
  },
]

const menuFields: Field[] = [
  { key: 'name', label: 'Name', type: 'text', required: true },
  { key: 'slug', label: 'Slug', type: 'slug', required: true },
  { key: 'description', label: 'Description', type: 'textarea' },
  { key: 'price', label: 'Price (GBP)', type: 'number' },
  { key: 'photo', label: 'Photo', type: 'image' },
  { key: 'available', label: 'Available today', type: 'boolean' },
]

const companyFields: Field[] = [
  { key: 'name', label: 'Business name', type: 'text', required: true },
  { key: 'tagline', label: 'Tagline', type: 'text' },
  { key: 'phone', label: 'Phone', type: 'text' },
  { key: 'address', label: 'Address', type: 'textarea' },
  { key: 'hours', label: 'Opening hours', type: 'textarea' },
]

export const harborAndPine: DemoClient = {
  slug: 'harbor-and-pine',
  name: 'Harbor & Pine Bakery',
  domain: 'harborandpine.com',
  owner: { name: 'Ruth Okafor', email: 'ruth@harborandpine.com' },
  editor: { name: 'Tom Brandt', email: 'tom@harborandpine.com' },
  pendingInvite: { email: 'jamie@harborandpine.com', role: 'editor' },
  site: { name: 'harborandpine.com', slug: 'harborandpine' },
  images: [
    {
      key: 'starter',
      picsumId: 42,
      alt: 'Wooden cafe table with two espresso cups by a window',
    },
    {
      key: 'focaccia',
      picsumId: 292,
      alt: 'Red onion, peppercorns and herbs on a wooden board',
    },
    {
      key: 'hours',
      picsumId: 1060,
      alt: 'Pour-over coffee being brewed with a gooseneck kettle',
    },
    {
      key: 'behindScenes',
      picsumId: 102,
      alt: 'Raspberries on a wooden rail in warm, hazy light',
    },
    {
      key: 'tart',
      picsumId: 1080,
      alt: 'Fresh strawberries piled in a crate',
    },
    {
      key: 'flatWhite',
      picsumId: 113,
      alt: 'Steam rising from a glass cup in cool, soft light',
    },
    {
      key: 'tea',
      picsumId: 225,
      alt: 'Glass teapot of pale tea beside a small cup, with yellow roses behind',
    },
  ],
  collections: [
    {
      key: 'posts',
      label: 'Posts',
      routePattern: '/posts/$slug',
      fields: postFields,
      entries: [
        {
          slug: 'sourdough-starter-turns-ten',
          status: 'live',
          earlier: [
            {
              title: 'Our starter turns ten',
              excerpt:
                'A jar of flour and water, fed every morning since 2016.',
            },
            {
              excerpt:
                'A jar of flour and water, fed every morning since 2016. Here is how it got us this far.',
            },
          ],
          data: {
            title: 'Our sourdough starter turns ten',
            slug: 'sourdough-starter-turns-ten',
            excerpt:
              'Ten years ago we fed a jar of flour and water for the first time. Here is what it taught us about patience.',
            coverImage: 'img:starter',
            publishedAt: '2026-09-12T08:00:00+01:00',
            category: 'behind-the-scenes',
            body: [
              'Our starter was born on a wet Tuesday in 2016, in a jar on the back shelf of a rented kitchen. It has been fed twice a day ever since, and it still sets the pace for the whole bakery.',
              'We keep it at a steady 24 degrees and feed it with a 1:1:1 ratio of starter, flour and water. In winter it lives closer to the oven. In summer the morning feed moves earlier, before the heat builds.',
              '## What ten years taught us',
              '- Temperature matters more than the recipe.',
              '- Slow fermentation tastes better, even when it costs an hour.',
              '- A starter you cannot smell is a starter that needs attention.',
              'Thank you to every regular who has asked about it, taken a loaf home and come back the next day for another.',
            ].join('\n\n'),
          },
          seo: {
            title: 'Our sourdough starter turns ten | Harbor & Pine',
            description:
              'Ten years of feeding one sourdough starter: what we learned about temperature, patience and slow fermentation at Harbor & Pine.',
            focusKeyphrase: 'sourdough starter',
          },
        },
        {
          slug: 'weekend-focaccia-rosemary',
          status: 'live',
          data: {
            title: 'Weekend focaccia with rosemary and sea salt',
            slug: 'weekend-focaccia-rosemary',
            excerpt:
              'A high-hydration focaccia you can make on a Saturday, with one fold every half hour.',
            coverImage: 'img:focaccia',
            publishedAt: '2026-08-29T08:00:00+01:00',
            category: 'recipes',
            body: [
              'This is the focaccia we bake on Saturdays. It needs a little planning, but very little hands-on work.',
              '## You will need',
              '- 500 g strong white flour',
              '- 380 g lukewarm water',
              '- 100 g active starter',
              '- 10 g fine salt',
              '- Olive oil, flaky sea salt and a few sprigs of rosemary',
              '## Method',
              'Mix the flour, water and starter until shaggy, rest for 30 minutes, then add the salt. Give the dough four folds over two hours, then leave it to rise until doubled. Oil a tray, tip the dough in, dimple it with oiled fingers and let it prove for an hour.',
              '![Red onion, peppercorns and parsley on a wooden board](img:focaccia)',
              'Bake at 240 degrees for 22 minutes, until deep gold. Eat it warm, the same day if you can.',
            ].join('\n\n'),
          },
          seo: {
            title: 'Weekend focaccia with rosemary | Harbor & Pine',
            description:
              'Our Saturday focaccia recipe: a high-hydration dough, four folds over two hours, rosemary and flaky sea salt.',
            focusKeyphrase: 'focaccia recipe',
          },
        },
        {
          slug: 'saturday-hours-winter',
          status: 'ready',
          data: {
            title: 'We are open until 6pm on Saturdays',
            slug: 'saturday-hours-winter',
            excerpt:
              'From 1 November our Saturday hours run until 6pm, so the afternoon loaves are back on the shelf.',
            coverImage: 'img:hours',
            publishedAt: '2026-10-10T09:00:00+01:00',
            category: 'news',
            body: [
              'From Saturday 1 November we will be open until 6pm, up from 4pm. Sunday stays the same, 8am to 2pm.',
              'The later hours mean the afternoon sourdough batch goes on sale at 3pm, so there will be fresh loaves when you finish your walk.',
            ].join('\n\n'),
          },
          seo: {
            title: 'Saturday opening hours until 6pm | Harbor & Pine',
            description:
              'From 1 November Harbor & Pine is open until 6pm on Saturdays, with a fresh afternoon sourdough batch at 3pm.',
            focusKeyphrase: 'bakery opening hours',
          },
        },
        {
          slug: 'inside-the-4am-shift',
          status: 'draft',
          data: {
            title: 'Inside the 4am shift',
            slug: 'inside-the-4am-shift',
            excerpt: 'What happens between the first mix and the first sale.',
            publishedAt: '2026-10-20T07:00:00+01:00',
            coverImage: 'img:behindScenes',
            category: 'behind-the-scenes',
            body: [
              'The first mixer goes on at four. By half past, the dough for the day is resting, and the ovens are almost at temperature.',
              'This post is still being written. We want to get the timings right before we publish them.',
            ].join('\n\n'),
          },
        },
      ],
    },
    {
      key: 'menu',
      label: 'Menu',
      routePattern: '/menu/$slug',
      fields: menuFields,
      entries: [
        {
          slug: 'strawberry-vanilla-tart',
          status: 'live',
          data: {
            name: 'Strawberry and vanilla tart',
            slug: 'strawberry-vanilla-tart',
            description:
              'Short pastry, vanilla custard and strawberries from the market, glazed in the morning.',
            price: 4.2,
            photo: 'img:tart',
            available: true,
          },
        },
        {
          slug: 'flat-white',
          status: 'live',
          data: {
            name: 'Flat white',
            slug: 'flat-white',
            description:
              'Double shot, velvety milk. Made with beans from a roaster in Lowhaven.',
            price: 3.1,
            photo: 'img:flatWhite',
            available: true,
          },
        },
        {
          slug: 'lemon-honey-tea',
          status: 'live',
          data: {
            name: 'Lemon and honey tea',
            slug: 'lemon-honey-tea',
            description:
              'Loose leaf tea, lemon slices and local honey. Served in a pot for two.',
            price: 2.8,
            photo: 'img:tea',
            available: true,
          },
        },
        {
          slug: 'raspberry-danish',
          status: 'draft',
          data: {
            name: 'Raspberry danish',
            slug: 'raspberry-danish',
            description:
              'Laminated dough with raspberry jam and vanilla crème pâtissière.',
            price: 3.6,
            available: false,
          },
        },
      ],
    },
  ],
  global: {
    key: 'company',
    label: 'Company info',
    fields: companyFields,
    values: {
      name: 'Harbor & Pine Bakery',
      tagline: 'Slow-fermented bread on Mill Street since 2016.',
      phone: '020 7946 0312',
      address: '14 Mill Street, Lowhaven LH4 9RT',
      hours:
        'Tuesday to Friday 7am to 5pm\nSaturday 8am to 6pm\nSunday 8am to 2pm',
    },
  },
}
