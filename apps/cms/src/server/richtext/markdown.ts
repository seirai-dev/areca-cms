type Mark = {
  type: string
  attrs?: Record<string, unknown>
}

type PMNode = {
  type: string
  attrs?: Record<string, unknown>
  content?: PMNode[]
  marks?: Mark[]
  text?: string
}

function asNode(value: unknown): PMNode {
  return value as PMNode
}

/** Escape literal inline syntax and paragraph-start block markers. */
function escapeText(value: string): string {
  return value
    .replace(/[\\`*_[\]<>~#-]/g, '\\$&')
    .replace(
      /^(\s*)(\+|\d+[.)])(?=\s)/gm,
      (_match, space: string, marker: string) =>
        `${space}${marker.replace(/([+.)])$/, '\\$1')}`,
    )
}

function destination(value: string): string {
  return value.replace(/[%\\\s()<>"']/g, (character) =>
    character === '%'
      ? '%'
      : encodeURIComponent(character).replace(
          /[()']/g,
          (punctuation) =>
            `%${punctuation.charCodeAt(0).toString(16).toUpperCase()}`,
        ),
  )
}

/**
 * A code span whose backtick run cannot close inside the text. Padding with a
 * space keeps leading or trailing backticks, and edge spaces, from being
 * trimmed by the parser.
 */
function codeSpan(text: string): string {
  const runs = text.match(/`+/g) ?? []
  const fence = '`'.repeat(Math.max(1, ...runs.map((run) => run.length + 1)))
  const padded =
    text.startsWith('`') ||
    text.endsWith('`') ||
    (text.startsWith(' ') && text.endsWith(' ') && text.trim().length > 0)
  const pad = padded ? ' ' : ''
  return `${fence}${pad}${text}${pad}${fence}`
}

/**
 * Set while one `serializeMarkdown` call runs (it is synchronous). With markers
 * on, an entry link is a reference link whose label is `areca-entry-N`, and its
 * destination sits in a definition at the end. The SDK localizes destinations
 * by those labels; the text reads the same and nothing extra renders.
 */
let entryLinks: {
  markers: boolean
  form: EntryLinkForm
  count: number
  definitions: string[]
  links: EntryLinkMarker[]
} | null = null

/** The Markdown destination prefix of an entry link: `entry:<id>` or `entry:<id>#anchor`. */
export const ENTRY_HREF_PREFIX = 'entry:'

/**
 * How an entry link is written outside the snapshot: `ids` (the default) as
 * `entry:<id>[#anchor]`, which agents read and write; `hrefs` as the stored
 * path, for the editor preview and for translation, which keep the stored form.
 */
export type EntryLinkForm = 'ids' | 'hrefs'

/**
 * One entry link's definition, in the order the definitions are written. The
 * snapshot publishes this list, so the SDK localizes exactly these definitions
 * and never a line of code that looks like one. `locale` is the language the
 * target's path is in.
 */
export type EntryLinkMarker = { label: string; locale?: string }

function wrapMarks(text: string, marks: Mark[] | undefined): string {
  if (!marks?.length) return text
  let out = text
  // Code takes no bold or italic, so their markers are never added to it.
  if (!marks.some((mark) => mark.type === 'code')) {
    if (marks.some((mark) => mark.type === 'italic')) out = `_${out}_`
    if (marks.some((mark) => mark.type === 'bold')) out = `**${out}**`
  }
  const link = marks.find((mark) => mark.type === 'link')
  if (link) {
    const href = typeof link.attrs?.href === 'string' ? link.attrs.href : ''
    const entryId = link.attrs?.entryId
    if (entryLinks?.markers && typeof entryId === 'string') {
      entryLinks.count += 1
      const label = `areca-entry-${entryLinks.count}`
      entryLinks.definitions.push(`[${label}]: ${destination(href)}`)
      const locale = link.attrs?.locale
      entryLinks.links.push({
        label,
        ...(typeof locale === 'string' && locale !== '' ? { locale } : {}),
      })
      return `[${out}][${label}]`
    }
    if (entryLinks?.form === 'ids' && typeof entryId === 'string') {
      // The form agents read and write: the id, with the section if any.
      const anchor = link.attrs?.anchor
      const section =
        typeof anchor === 'string' && anchor !== '' ? `#${anchor}` : ''
      return `[${out}](${destination(`${ENTRY_HREF_PREFIX}${entryId}${section}`)})`
    }
    out = `[${out}](${destination(href)})`
  }
  return out
}

function serializeInline(nodes: PMNode[] | undefined): string {
  if (!nodes?.length) return ''
  return nodes.map(serializeInlineNode).join('')
}

function serializeInlineNode(node: PMNode): string {
  // TanStack Markdown only recognises backslash hard breaks.
  if (node.type === 'hardBreak') return '\\\n'
  if (node.type === 'text') {
    const text = node.text ?? ''
    const isCode = node.marks?.some((mark) => mark.type === 'code')
    return wrapMarks(isCode ? codeSpan(text) : escapeText(text), node.marks)
  }
  if (node.content) return serializeInline(node.content)
  return ''
}

function serializeList(node: PMNode, ordered: boolean, indent: number): string {
  const items = node.content ?? []
  const start = typeof node.attrs?.start === 'number' ? node.attrs.start : 1
  return items
    .map((item, index) =>
      serializeListItem(item, ordered, start + index, indent),
    )
    .join('\n')
}

function serializeListItem(
  item: PMNode,
  ordered: boolean,
  number: number,
  indent: number,
): string {
  const marker = ordered ? `${number}. ` : '- '
  const pad = '  '.repeat(indent)
  const children = item.content ?? []
  const lines: string[] = []
  let usedMarker = false

  for (const child of children) {
    if (child.type === 'bulletList') {
      lines.push(serializeList(child, false, indent + 1))
      continue
    }
    if (child.type === 'orderedList') {
      lines.push(serializeList(child, true, indent + 1))
      continue
    }
    const text = serializeBlock(child, indent)
    if (!usedMarker) {
      lines.push(`${pad}${marker}${text}`)
      usedMarker = true
    } else {
      lines.push(`${pad}${text}`)
    }
  }

  if (!usedMarker) lines.push(`${pad}${marker}`.trimEnd())
  return lines.join('\n')
}

function serializeTableCell(node: PMNode | undefined): string {
  if (!node) return ''
  const value = (node.content ?? [])
    .map((child) => serializeBlock(child))
    .join(' ')
  return value.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ')
}

function serializeTable(node: PMNode): string {
  const rows = node.content ?? []
  if (rows.length === 0) return ''
  const columnCount = Math.max(
    1,
    ...rows.map((row) => row.content?.length ?? 0),
  )
  const renderRow = (row: PMNode | undefined) => {
    const cells = Array.from({ length: columnCount }, (_, index) =>
      serializeTableCell(row?.content?.[index]),
    )
    return `| ${cells.join(' | ')} |`
  }
  return [
    renderRow(rows[0]),
    `| ${Array.from({ length: columnCount }, () => '---').join(' | ')} |`,
    ...rows.slice(1).map(renderRow),
  ].join('\n')
}

function serializeBlock(node: PMNode, indent = 0): string {
  switch (node.type) {
    case 'doc':
      return (node.content ?? [])
        .map((child) => serializeBlock(child))
        .filter((block) => block.length > 0)
        .join('\n\n')
    case 'heading': {
      const level = typeof node.attrs?.level === 'number' ? node.attrs.level : 2
      return `${'#'.repeat(level)} ${serializeInline(node.content)}`
    }
    case 'paragraph':
      return serializeInline(node.content)
    case 'blockquote': {
      const inner = (node.content ?? [])
        .map((child) => serializeBlock(child))
        .join('\n\n')
      return inner
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')
    }
    case 'codeBlock': {
      const language =
        typeof node.attrs?.language === 'string' ? node.attrs.language : ''
      const code = (node.content ?? [])
        .map((child) => child.text ?? '')
        .join('')
      const runs = code.match(/`+/g) ?? []
      const fence = '`'.repeat(
        Math.max(3, ...runs.map((run) => run.length + 1)),
      )
      const safeLanguage = language.replace(/[\r\n`]/g, '')
      return `${fence}${safeLanguage}\n${code}\n${fence}`
    }
    case 'bulletList':
      return serializeList(node, false, indent)
    case 'orderedList':
      return serializeList(node, true, indent)
    case 'horizontalRule':
      return '---'
    case 'image': {
      const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : ''
      const src = typeof node.attrs?.src === 'string' ? node.attrs.src : ''
      return `![${escapeText(alt)}](${destination(src)})`
    }
    case 'table':
      return serializeTable(node)
    default:
      return serializeInline(node.content)
  }
}

function serialize(
  json: unknown,
  markers: boolean,
  form: EntryLinkForm = 'ids',
): { markdown: string; entryLinks: EntryLinkMarker[] } {
  const previous = entryLinks
  entryLinks = { markers, form, count: 0, definitions: [], links: [] }
  try {
    const body = serializeBlock(asNode(json)).trim()
    const { definitions, links } = entryLinks
    return {
      markdown:
        definitions.length > 0 ? `${body}\n\n${definitions.join('\n')}` : body,
      entryLinks: links,
    }
  } finally {
    entryLinks = previous
  }
}

/**
 * The Markdown of a stored rich text value. Entry links are written `entry:<id>`
 * unless `entryLinkForm` is 'hrefs' (see EntryLinkForm). `entryLinkMarkers`
 * writes reference-style markers instead (the snapshot does not use this).
 */
export function serializeMarkdown(
  json: unknown,
  options: { entryLinkMarkers?: boolean; entryLinkForm?: EntryLinkForm } = {},
): string {
  return serialize(
    json,
    options.entryLinkMarkers === true,
    options.entryLinkForm ?? 'ids',
  ).markdown
}

/**
 * The published Markdown of a rich text value, with its entry link markers:
 * one per entry link, in definition order (see `EntryLinkMarker`).
 */
export function serializeMarkdownWithEntryLinks(json: unknown): {
  markdown: string
  entryLinks: EntryLinkMarker[]
} {
  return serialize(json, true)
}

const BLOCK_JOIN = new Set([
  'doc',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'table',
  'tableRow',
])

function extractPlain(node: PMNode): string {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'hardBreak') return '\n'
  if (node.type === 'image')
    return typeof node.attrs?.alt === 'string' ? node.attrs.alt : ''
  if (node.type === 'horizontalRule') return ''
  // Code blocks are not prose; they would fill descriptions with source code.
  if (node.type === 'codeBlock') return ''
  const parts = (node.content ?? []).map(extractPlain)
  if (BLOCK_JOIN.has(node.type)) {
    return parts.filter((part) => part.length > 0).join('\n')
  }
  return parts.join('')
}

export function richTextPlainText(json: unknown): string {
  if (typeof json !== 'object' || json === null) return ''
  return extractPlain(asNode(json)).trim()
}
