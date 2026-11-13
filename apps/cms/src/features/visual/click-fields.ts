import { SEO_KEY } from '#/lib/seo'
import { m } from '#/paraglide/messages'

/** A field the preview can open: its key and the label its chip shows. */
export type ClickField = { key: string; label: string }

/** The SEO fields a page can mark (`$seo.title`), with the editor's labels. */
export function seoClickFields(): ClickField[] {
  const labels: Record<string, string> = {
    title: m.editor_seo_title(),
    description: m.editor_seo_description(),
    focusKeyphrase: m.editor_seo_keyphrase(),
    ogTitle: m.editor_seo_og_title(),
    ogDescription: m.editor_seo_og_description(),
    ogImage: m.editor_seo_og_image(),
    summary: m.editor_seo_summary(),
    keyTakeaways: m.editor_seo_takeaways(),
    faq: m.editor_seo_faq(),
    about: m.editor_seo_about(),
    author: m.editor_seo_author(),
    canonicalUrl: m.editor_seo_canonical(),
    jsonLd: m.editor_seo_jsonld(),
  }
  return Object.entries(labels).map(([key, label]) => ({
    key: `${SEO_KEY}.${key}`,
    label,
  }))
}
