import type {
  I18nConfig,
  SiteLanguages,
  Snapshot,
  SnapshotGlobal,
} from './types.js'

/**
 * Entry links in pulled content. The CMS writes each link to another entry
 * with the path of that entry in the language of the text, and marks it:
 *
 * - `json`: the link mark has `attrs.entryId`;
 * - `document`: the link node has `entryId`;
 * - `html`: the anchor has `data-areca-entry`;
 * - `markdown`: the link is a reference (`[text][areca-entry-1]`) whose
 *   definition (`[areca-entry-1]: /path`) holds the destination. The value's
 *   `entryLinks` lists those definitions in order; only they are rewritten, so
 *   code that looks like a definition is never touched.
 *
 * `localizePath` changes the destination of those links only, never other
 * links. Snapshots from older CMS versions have no markers and are unchanged.
 */

/** Maps a path (without `#section`) in one language to the path the site serves it at. */
export type LocalizePath = NonNullable<I18nConfig['localizePath']>

/**
 * The default: the main language keeps its paths; any other language gets
 * `/<locale>` in front (`/` becomes `/<locale>`).
 */
export function defaultLocalizePath(main: string): LocalizePath {
  return (path, locale) => {
    if (locale === main) return path
    return path === '/' ? `/${locale}` : `/${locale}${path}`
  }
}

const HTML_ENTRY_LINK =
  /<a href="([^"]*)" data-areca-entry="([^"]*)"(?: data-areca-locale="([^"]*)")?>/g

const HTML_UNESCAPES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#96;': '`',
}
const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
}

function unescapeHtml(value: string): string {
  return value.replace(
    /&(amp|lt|gt|quot|#39|#96);/g,
    (match) => HTML_UNESCAPES[match] ?? match,
  )
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"'`]/g, (char) => HTML_ESCAPES[char] ?? char)
}

/** Localizes an href: the path part, with any `#section` kept as it is. */
function localizeHref(
  href: string,
  locale: string,
  localize: LocalizePath,
): string {
  const hash = href.indexOf('#')
  const path = hash === -1 ? href : href.slice(0, hash)
  const section = hash === -1 ? '' : href.slice(hash)
  return `${localize(path, locale)}${section}`
}

type Json = unknown

function localizeJson(
  value: Json,
  locale: string,
  localize: LocalizePath,
): Json {
  if (Array.isArray(value))
    return value.map((item) => localizeJson(item, locale, localize))
  if (!value || typeof value !== 'object') return value
  const node = value as Record<string, unknown>
  const copy: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(node)) {
    copy[key] = localizeJson(child, locale, localize)
  }
  const marks = copy.marks
  if (Array.isArray(marks)) {
    copy.marks = marks.map((mark) => {
      if (!isEntryLinkMark(mark)) return mark
      const attrs = mark.attrs as Record<string, unknown>
      return {
        ...mark,
        attrs: {
          ...attrs,
          href: localizeHref(
            String(attrs.href),
            linkLocale(attrs.locale, locale),
            localize,
          ),
        },
      }
    })
  }
  return copy
}

function isEntryLinkMark(
  value: unknown,
): value is { type: 'link'; attrs: Record<string, unknown> } {
  if (!value || typeof value !== 'object') return false
  const mark = value as { type?: unknown; attrs?: unknown }
  return (
    mark.type === 'link' &&
    typeof mark.attrs === 'object' &&
    mark.attrs !== null &&
    typeof (mark.attrs as { entryId?: unknown }).entryId === 'string'
  )
}

function localizeDocument(
  value: Json,
  locale: string,
  localize: LocalizePath,
): Json {
  if (Array.isArray(value))
    return value.map((item) => localizeDocument(item, locale, localize))
  if (!value || typeof value !== 'object') return value
  const node = value as Record<string, unknown>
  const copy: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(node)) {
    copy[key] = localizeDocument(child, locale, localize)
  }
  if (
    copy.type === 'link' &&
    typeof copy.entryId === 'string' &&
    typeof copy.href === 'string'
  ) {
    copy.href = localizeHref(
      copy.href,
      linkLocale(copy.locale, locale),
      localize,
    )
  }
  return copy
}

/**
 * The language a link's path is in: the one the CMS marked on the link, or the
 * language of the text for a snapshot from before the markers.
 */
function linkLocale(marked: unknown, textLocale: string): string {
  return typeof marked === 'string' && marked !== '' ? marked : textLocale
}

/** One definition the CMS lists in `entryLinks`, in the order it writes them. */
type MarkdownEntryLink = { label: string; locale?: string }

/**
 * Localizes the definitions a snapshot lists, which the CMS writes at the end
 * of the Markdown, one per line, in list order. Nothing else is touched: code
 * that looks like a definition stays as it is. A Markdown that does not match
 * its list is left unchanged.
 */
function localizeMarkdownLinks(
  markdown: string,
  links: MarkdownEntryLink[],
  textLocale: string,
  localize: LocalizePath,
): string {
  if (links.length === 0) return markdown
  const lines = markdown.split('\n')
  const first = lines.length - links.length
  if (first < 0) return markdown
  const next = [...lines]
  for (const [index, link] of links.entries()) {
    const match = /^\[([^\]]+)\]: (\S+)$/.exec(lines[first + index] ?? '')
    if (!match || match[1] !== link.label) return markdown
    next[first + index] = `[${link.label}]: ${localizeHref(
      match[2]!,
      linkLocale(link.locale, textLocale),
      localize,
    )}`
  }
  return next.join('\n')
}

function isRichTextValue(value: unknown): value is {
  json: unknown
  markdown: string
  html: string
  document: unknown
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const rich = value as Record<string, unknown>
  return (
    typeof rich.markdown === 'string' &&
    typeof rich.html === 'string' &&
    typeof rich.document === 'object' &&
    rich.document !== null &&
    'json' in rich
  )
}

/** One rich text value, with its entry links localized to `locale`. */
function localizeRichText<
  T extends {
    json: unknown
    markdown: string
    html: string
    document: unknown
    entryLinks?: MarkdownEntryLink[]
  },
>(value: T, locale: string, localize: LocalizePath): T {
  return {
    ...value,
    json: localizeJson(value.json, locale, localize),
    document: localizeDocument(value.document, locale, localize),
    html: value.html.replace(
      HTML_ENTRY_LINK,
      (_match, href: string, entryId: string, marked?: string) => {
        const next = localizeHref(
          unescapeHtml(href),
          linkLocale(marked, locale),
          localize,
        )
        const language =
          marked === undefined ? '' : ` data-areca-locale="${marked}"`
        return `<a href="${escapeHtml(next)}" data-areca-entry="${entryId}"${language}>`
      },
    ),
    markdown:
      value.entryLinks === undefined
        ? value.markdown
        : localizeMarkdownLinks(
            value.markdown,
            value.entryLinks,
            locale,
            localize,
          ),
  }
}

type View = { data: Record<string, unknown> }

function localizeView<V extends View>(
  view: V,
  locale: string,
  localize: LocalizePath,
): V {
  const data: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(view.data)) {
    data[key] = isRichTextValue(value)
      ? localizeRichText(value, locale, localize)
      : value
  }
  return { ...view, data }
}

/**
 * One entry or section, with the entry links of every language view
 * localized. The top-level view is in `locale` (the language it is served in).
 */
export function localizeEntryLinks<
  T extends View & { locale?: string; locales?: Record<string, View> },
>(entry: T, languages: SiteLanguages, localize: LocalizePath): T {
  const topLocale = entry.locale ?? languages.main
  const next = localizeView(entry, topLocale, localize)
  if (!entry.locales) return next as T
  return {
    ...next,
    locales: Object.fromEntries(
      Object.entries(entry.locales).map(([locale, view]) => [
        locale,
        localizeView(view, locale, localize),
      ]),
    ),
  } as T
}

/** Entry links in every collection entry of a snapshot. */
export function localizeCollectionEntryLinks(
  collections: Snapshot['collections'],
  languages: SiteLanguages,
  localize: LocalizePath,
): Snapshot['collections'] {
  return Object.fromEntries(
    Object.entries(collections).map(([key, entries]) => [
      key,
      entries.map((entry) => localizeEntryLinks(entry, languages, localize)),
    ]),
  )
}

/** Entry links in every site content section of a snapshot. */
export function localizeGlobalEntryLinks(
  globals: Record<string, SnapshotGlobal>,
  languages: SiteLanguages,
  localize: LocalizePath,
): Record<string, SnapshotGlobal> {
  return Object.fromEntries(
    Object.entries(globals).map(([key, global]) => [
      key,
      localizeEntryLinks(global, languages, localize),
    ]),
  )
}
