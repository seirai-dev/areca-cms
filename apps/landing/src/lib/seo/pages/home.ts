import { m } from '@/paraglide/messages'
import { faq } from '@/lib/faq'
import { FEATURES } from '@/components/sections/features'
import {
  faqPage,
  ids,
  ref,
  site,
  softwareApplication,
  softwareSourceCode,
  url,
  videoObject,
} from '..'
import type { PageSeo } from '..'

// First commit of public/video/areca-tour.mp4. Update it when the tour is
// re-recorded.
const TOUR_UPLOAD_DATE = '2026-11-04T00:43:09+01:00'
// Matches m.hero_watch_length ("80 seconds").
const TOUR_DURATION = 'PT80S'

/** The home page: the product, its source, the tour video and the FAQ. */
export function homeSeo(): PageSeo {
  const page = url('/')
  const tour = videoObject({
    url: page,
    name: m.video_dialog_title(),
    description: `${m.video_dialog_title()}, ${m.hero_watch_length()}. ${m.video_caption()}`,
    thumbnailUrl: url('/video/poster.webp'),
    contentUrl: url('/video/areca-tour.mp4'),
    uploadDate: TOUR_UPLOAD_DATE,
    duration: TOUR_DURATION,
  })
  return {
    path: '/',
    title: m.meta_title(),
    absoluteTitle: true,
    description: m.meta_description(),
    about: ids.software(site),
    mainEntity: ids.software(site),
    schema: [
      softwareApplication(site, {
        // The screenshots in the features section, in the light theme.
        screenshot: FEATURES.map((f) => url(`/shots/${f.shot}-light.webp`)),
        featureList: [
          ...FEATURES.map((f) => `${f.tab()}: ${f.body()}`),
          ...[
            [m.home_point1_title, m.home_point1_body],
            [m.home_point2_title, m.home_point2_body],
            [m.home_point3_title, m.home_point3_body],
            [m.home_point4_title, m.home_point4_body],
            [m.agency_point1_title, m.agency_point1_body],
            [m.agency_point2_title, m.agency_point2_body],
            [m.agency_point3_title, m.agency_point3_body],
            [m.agency_point4_title, m.agency_point4_body],
            [m.ai_title, m.ai_lead],
          ].map(([title, body]) => `${title()}: ${body()}`),
        ],
        video: ref(String(tour['@id'])),
      }),
      softwareSourceCode(site),
      tour,
      faqPage(
        page,
        faq.map((q) => ({ question: q.question(), answer: q.answer() })),
      ),
    ],
  }
}
