import type { Field } from '#/lib/types'

import type { DemoClient } from './types'

const rideFields: Field[] = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'slug', label: 'Slug', type: 'slug', required: true },
  { key: 'date', label: 'Date', type: 'datetime', required: true },
  { key: 'distanceKm', label: 'Distance (km)', type: 'number' },
  { key: 'meetingPoint', label: 'Meeting point', type: 'text' },
  { key: 'route', label: 'Route link', type: 'url' },
  { key: 'body', label: 'Details', type: 'richtext' },
  { key: 'coverImage', label: 'Cover image', type: 'image' },
]

const newsFields: Field[] = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'slug', label: 'Slug', type: 'slug', required: true },
  { key: 'excerpt', label: 'Excerpt', type: 'textarea' },
  { key: 'body', label: 'Body', type: 'richtext', required: true },
  { key: 'publishedAt', label: 'Published at', type: 'datetime' },
  { key: 'coverImage', label: 'Cover image', type: 'image' },
]

export const northwindCycling: DemoClient = {
  slug: 'northwind-cycling',
  name: 'Northwind Cycling Club',
  domain: 'northwindcc.example',
  owner: { name: 'Sam Whitfield', email: 'sam@northwindcc.example' },
  editor: { name: 'Dana Kowalczyk', email: 'dana@northwindcc.example' },
  site: { name: 'northwindcc.example', slug: 'northwindcc' },
  images: [
    {
      key: 'coastLoop',
      picsumId: 203,
      alt: 'A man standing beside a bicycle on a sunny waterfront',
    },
    // Deliberately without alt text: shows the library "needs a description" state.
    { key: 'gallows', picsumId: 1018 },
    {
      key: 'canalSocial',
      picsumId: 212,
      alt: 'Bicycle parked at a rack on a city street in low sun',
    },
    {
      key: 'springOpener',
      picsumId: 1077,
      alt: 'Two cyclists in motion, shot in black and white',
    },
    { key: 'helmets', picsumId: 76 },
  ],
  collections: [
    {
      key: 'rides',
      label: 'Rides',
      routePattern: '/rides/$slug',
      fields: rideFields,
      entries: [
        {
          slug: 'harbour-coast-loop',
          status: 'live',
          data: {
            title: 'Harbour coast loop, 80 km',
            slug: 'harbour-coast-loop',
            date: '2026-10-25T08:30:00+01:00',
            distanceKm: 80,
            meetingPoint: 'Harbour car park, Lowhaven',
            route: 'https://ridewithgps.com/routes/northwind-coast-80',
            body: [
              'Our flagship Sunday ride along the coast road. Two regroups, one café stop at the halfway point, and a steady pace for the last 20 km.',
              '## What to bring',
              '- Lights, even in daylight',
              '- A spare tube and a pump',
              '- Enough food for 3 hours',
            ].join('\n\n'),
            coverImage: 'img:coastLoop',
          },
          seo: {
            title: 'Harbour coast loop, 80 km | Northwind Cycling Club',
            description:
              'Our Sunday 80 km coast loop from Lowhaven harbour, with two regroups and a café stop halfway round. All paces welcome.',
            focusKeyphrase: 'coast ride Lowhaven',
          },
        },
        {
          slug: 'gallows-ridge-hill-repeats',
          status: 'ready',
          data: {
            title: 'Gallows Ridge hill repeats',
            slug: 'gallows-ridge-hill-repeats',
            date: '2026-11-01T18:45:00+00:00',
            distanceKm: 55,
            meetingPoint: 'Gallows Lane lay-by',
            route: 'https://ridewithgps.com/routes/gallows-ridge-repeats',
            body: [
              'Six climbs of Gallows Ridge at a conversational effort, then the long descent home. Lights are compulsory from October.',
            ].join('\n\n'),
            coverImage: 'img:gallows',
          },
          seo: {
            title: 'Gallows Ridge hill repeats | Northwind Cycling Club',
            description:
              'A Tuesday evening session on Gallows Ridge: six hill repeats at a steady effort, then a fast descent back to the lay-by.',
            focusKeyphrase: 'hill repeats',
          },
        },
        {
          slug: 'canal-ring-social',
          status: 'live',
          data: {
            title: 'Canal ring social ride',
            slug: 'canal-ring-social',
            date: '2026-09-27T10:00:00+01:00',
            distanceKm: 42,
            meetingPoint: 'Canal Street bridge',
            route: 'https://ridewithgps.com/routes/canal-ring-42',
            body: [
              'A flat, friendly 42 km loop of the canal towpath and the lanes beyond. We stop for coffee at the lock and finish at the pub.',
            ].join('\n\n'),
            coverImage: 'img:canalSocial',
          },
          seo: {
            title: 'Canal ring social ride | Northwind Cycling Club',
            description:
              'A flat 42 km social loop along the canal towpath, with a coffee stop at the lock and a finish at the pub.',
            focusKeyphrase: 'social bike ride',
          },
        },
        {
          slug: 'spring-opener-100km',
          status: 'draft',
          data: {
            title: 'Spring opener, 100 km',
            slug: 'spring-opener-100km',
            date: '2027-03-14T08:00:00+00:00',
            distanceKm: 100,
            meetingPoint: 'Clubhouse, Mill Road',
            body: 'Route to be confirmed with the ride captains.',
            coverImage: 'img:springOpener',
          },
        },
      ],
    },
    {
      key: 'news',
      label: 'News',
      routePattern: '/news/$slug',
      fields: newsFields,
      entries: [
        {
          slug: 'welcome-to-the-2026-season',
          status: 'live',
          data: {
            title: 'Welcome to the 2026 season',
            slug: 'welcome-to-the-2026-season',
            excerpt:
              'Our calendar is full for autumn, with three new group rides.',
            body: [
              'The autumn programme is out. We have three new group rides on the calendar, a Tuesday evening session for riders who want to climb, and a monthly café ride for anyone who would rather talk than race.',
              'Ride captains are listed on each event page. If you want to help lead a group, speak to Dana at the clubhouse.',
            ].join('\n\n'),
            publishedAt: '2026-09-02T09:00:00+01:00',
          },
        },
        {
          slug: 'new-helmet-rack-clubhouse',
          status: 'live',
          data: {
            title: 'A helmet rack for the clubhouse',
            slug: 'new-helmet-rack-clubhouse',
            excerpt:
              'Thanks to a small grant, members now have somewhere to leave helmets and shoes.',
            body: [
              'The new rack by the clubhouse door has space for 24 helmets. Please leave shoes and bottles on the shelf below, not on the floor.',
            ].join('\n\n'),
            publishedAt: '2026-09-20T09:00:00+01:00',
            coverImage: 'img:helmets',
          },
        },
        {
          slug: 'spring-block-booking',
          status: 'scheduled',
          scheduledAt: '2026-11-15T09:00:00+00:00',
          timezone: 'Europe/London',
          data: {
            title: 'Spring block booking opens 15 November',
            slug: 'spring-block-booking',
            excerpt:
              'Members can reserve places on the spring training weekends from 15 November.',
            body: [
              'Places on the March and April training weekends open to members at 9am on 15 November. Non-members can join from 22 November if places remain.',
            ].join('\n\n'),
            publishedAt: '2026-11-15T09:00:00+00:00',
            coverImage: 'img:springOpener',
          },
        },
      ],
    },
  ],
  global: {
    key: 'company',
    label: 'Club info',
    fields: [
      { key: 'name', label: 'Club name', type: 'text', required: true },
      { key: 'tagline', label: 'Tagline', type: 'text' },
      { key: 'email', label: 'Contact email', type: 'text' },
      { key: 'meetingPlace', label: 'Clubhouse', type: 'textarea' },
    ],
    values: {
      name: 'Northwind Cycling Club',
      tagline: 'Amateur road riding since 1987, every pace welcome.',
      email: 'hello@northwindcc.example',
      meetingPlace: 'Clubhouse, 3 Mill Road, Lowhaven',
    },
  },
}
