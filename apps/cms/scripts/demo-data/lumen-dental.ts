import type { Field } from '#/lib/types'

import type { DemoClient } from './types'

const serviceFields: Field[] = [
  {
    key: 'title',
    label: 'Title',
    type: 'text',
    required: true,
    translatable: true,
  },
  { key: 'slug', label: 'Slug', type: 'slug', required: true },
  { key: 'summary', label: 'Summary', type: 'textarea', translatable: true },
  { key: 'body', label: 'Body', type: 'richtext', translatable: true },
  { key: 'image', label: 'Image', type: 'image' },
]

export const lumenDental: DemoClient = {
  slug: 'lumen-dental',
  name: 'Lumen Dental Studio',
  domain: 'lumendentalstudio.com',
  owner: { name: 'Dr. Niels Bakker', email: 'niels@lumendentalstudio.com' },
  editor: { name: 'Sofie Janssen', email: 'sofie@lumendentalstudio.com' },
  site: { name: 'lumendentalstudio.com', slug: 'lumen-dental' },
  languages: { main: 'en', all: ['en', 'nl'] },
  images: [
    {
      key: 'hygiene',
      picsumId: 119,
      alt: 'Laptop and a block calendar on a bright white desk',
    },
    {
      key: 'whitening',
      picsumId: 1081,
      alt: 'White geometric architecture against a pale sky',
    },
    {
      key: 'implants',
      picsumId: 55,
      alt: 'Small yellow-green plant growing from a weathered log beside still water',
    },
  ],
  collections: [
    {
      key: 'services',
      label: 'Services',
      routePattern: '/services/$slug',
      fields: serviceFields,
      entries: [
        {
          slug: 'hygiene-and-checkups',
          status: 'live',
          data: {
            title: 'Hygiene visits and check-ups',
            slug: 'hygiene-and-checkups',
            summary:
              'A thorough clean and examination every six months, with a clear plan for anything we find.',
            body: [
              'Most patients come in twice a year for a check-up and a professional clean. We look at your gums, bite and existing work, and take X-rays when they are useful.',
              '## What happens at a visit',
              '- A full examination and gum measurements',
              '- Scale and polish with a gentle airflow clean',
              '- A written summary of anything to watch before your next visit',
            ].join('\n\n'),
            image: 'img:hygiene',
          },
          nl: {
            title: 'Hygiënebezoeken en controles',
            summary:
              'Een grondige reiniging en onderzoek elk half jaar, met een duidelijk plan voor alles wat we vinden.',
            body: [
              'De meeste patiënten komen twee keer per jaar langs voor een controle en een professionele reiniging. We kijken naar uw tandvlees, uw beet en bestaand werk, en maken röntgenfoto’s wanneer dat zinvol is.',
              '## Wat er tijdens een bezoek gebeurt',
              '- Een volledig onderzoek en metingen van het tandvlees',
              '- Scaling en polijsten met een zachte airflow-reiniging',
              '- Een schriftelijk overzicht van wat u voor uw volgende bezoek in de gaten moet houden',
            ].join('\n\n'),
          },
          seo: {
            title: 'Hygiene visits and check-ups | Lumen Dental Studio',
            description:
              'Six-monthly check-ups and professional cleaning at Lumen Dental Studio, with a written summary after every visit.',
            focusKeyphrase: 'dental check-up',
          },
        },
        {
          slug: 'teeth-whitening',
          status: 'ready',
          data: {
            title: 'Teeth whitening',
            slug: 'teeth-whitening',
            summary:
              'In-surgery or take-home whitening, planned after a check-up so your enamel is ready for it.',
            body: [
              'Whitening works best when the teeth and gums are healthy first. We start with a check-up, then agree on one of two routes: a single session in the surgery, or a custom tray you wear at home for two weeks.',
              'Sensitivity is common for a day or two. We give you a gel to use if it happens.',
            ].join('\n\n'),
            image: 'img:whitening',
          },
          nl: {
            title: 'Tanden bleken',
            summary:
              'Bleken in de praktijk of met een eigen tray thuis, gepland na een controle zodat uw glazuur er klaar voor is.',
            body: [
              'Bleken werkt het best als tanden en tandvlees eerst gezond zijn. We beginnen met een controle en kiezen daarna voor één van twee routes: één sessie in de praktijk, of een op maat gemaakte tray die u twee weken thuis draagt.',
              'Gevoeligheid komt vaak voor, een dag of twee. Dan krijgt u een gel mee om te gebruiken.',
            ].join('\n\n'),
          },
          seo: {
            title: 'Teeth whitening | Lumen Dental Studio',
            description:
              'In-surgery or take-home teeth whitening at Lumen Dental Studio, planned after a check-up so your teeth and gums are ready.',
            focusKeyphrase: 'teeth whitening',
          },
        },
        {
          slug: 'dental-implants',
          status: 'live',
          data: {
            title: 'Dental implants',
            slug: 'dental-implants',
            summary:
              'Replacing a missing tooth with a titanium implant and a crown that looks and works like your own.',
            body: [
              'An implant replaces the root of a missing tooth. After healing, which usually takes three to four months, we fit a crown that matches the teeth around it.',
              'Our first consultation includes a 3D scan so we can plan the position before any treatment starts.',
            ].join('\n\n'),
            image: 'img:implants',
          },
          seo: {
            title: 'Dental implants | Lumen Dental Studio',
            description:
              'Single-tooth dental implants at Lumen Dental Studio, planned with a 3D scan and finished with a custom crown.',
            focusKeyphrase: 'dental implants',
          },
        },
      ],
    },
  ],
  global: {
    key: 'practice',
    label: 'Practice info',
    fields: [
      { key: 'name', label: 'Practice name', type: 'text', required: true },
      { key: 'tagline', label: 'Tagline', type: 'text' },
      { key: 'phone', label: 'Phone', type: 'text' },
      { key: 'address', label: 'Address', type: 'textarea' },
    ],
    values: {
      name: 'Lumen Dental Studio',
      tagline: 'Calm, precise dentistry for the whole family.',
      phone: '020 7946 0871',
      address: '8 Orchard Row, Lowhaven LH2 6QA',
    },
  },
}
