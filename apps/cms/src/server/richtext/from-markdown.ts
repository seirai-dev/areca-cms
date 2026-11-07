import { parseMarkdown } from '@tanstack/markdown/parser'
import type {
  BlockNode,
  ImageNode,
  InlineNode,
  ListItemNode,
  TableCellNode,
  TableNode,
} from '@tanstack/markdown'

import { ID_MAX_LENGTH } from '#/lib/content-limits'
import { normalizeCodeLanguage } from '#/lib/highlight'

import { isAllowedImageSrc, isAllowedLinkHref } from './allowlist'
import { ENTRY_HREF_PREFIX, serializeMarkdown } from './markdown'

/**
 * A TipTap (ProseMirror) JSON document as stored in the CMS. The validator in
 * ./validate.ts is the authority on what is accepted; this type is only a
 * structural hint for callers.
 */
export type RichTextDoc = { type: 'doc'; content: unknown[] }

export type MarkdownToRichTextOptions = {
  /**
   * Resolves an `asset:<id>` image reference to the `src` the editor stores
   * (for CMS assets, `/api/assets/file/<storageKey>`). Returning `null` drops
   * the image.
   */
  resolveAssetSrc?: (assetId: string) => string | null
  /**
   * Called with a message for each link that was dropped. The text of a
   * dropped link is kept as plain text.
   */
  onWarning?: (message: string) => void
  /**
   * The entry each link resolved to, keyed by the href as the Markdown writes
   * it (`entry:<id>`, a site path or an own-domain URL). Found in one batch
   * before conversion (see resolveMarkdownLinkTargets), so this stays
   * synchronous. A link with no entry here keeps the rules of its href.
   */
  linkTargets?: ReadonlyMap<string, MarkdownLinkResolution>
  /** Called with the href of every link, as written, before any check. */
  onLink?: (href: string) => void
}

/** A link to an entry, as the converter stores it (the link mark's attributes). */
export type MarkdownLinkTarget = {
  entryId: string
  collection: string
  anchor: string | null
  /** The entry's path in the language of the text, with the section. */
  href: string
}

/**
 * A path that more than one entry answers to, as the resolver reports it. The
 * link stays a plain link and gets a warning (see ambiguousLinkWarning).
 */
export type MarkdownLinkAmbiguous = { ambiguous: true }

/** What the resolver found for one href: an entry, or an ambiguous path. */
export type MarkdownLinkResolution = MarkdownLinkTarget | MarkdownLinkAmbiguous

/** Warning for a path that more than one entry answers to. */
export function ambiguousLinkWarning(href: string): string {
  return `The link to ${href} matches more than one page; use entry:<id>.`
}

/** Warning for a Markdown link whose href is not allowed (see isAllowedLinkHref). */
export function droppedLinkWarning(href: string): string {
  return `Removed the link to "${href}": links must be https://, mailto:, a site path like /page or an anchor like #section.`
}

/** Warning for an `entry:` link whose id is not an entry of this site (or has no page). */
export function unknownEntryLinkWarning(href: string): string {
  const id = href.slice(ENTRY_HREF_PREFIX.length).split('#')[0]
  return `Removed the link to entry "${id}": no entry of this site has that id, or it has no page. The text is kept.`
}

/**
 * The distinct link hrefs a Markdown text writes, as written. Code is not a
 * link. Feed them to resolveMarkdownLinkTargets.
 */
export function markdownLinkHrefs(markdown: string): string[] {
  const hrefs = new Set<string>()
  markdownToRichText(markdown, { onLink: (href) => hrefs.add(href) })
  return [...hrefs]
}

type Mark =
  | { type: 'bold' }
  | { type: 'italic' }
  | { type: 'code' }
  | {
      type: 'link'
      attrs: {
        href: string
        entryId?: string
        collection?: string
        anchor?: string | null
      }
    }

type PMNode = {
  type: string
  attrs?: Record<string, unknown>
  content?: PMNode[]
  marks?: Mark[]
  text?: string
}

/** Inline content, or a block-level image split out of a paragraph. */
type Piece = { kind: 'inline'; node: PMNode } | { kind: 'block'; node: PMNode }

type Converter = {
  resolveAssetSrc: (assetId: string) => string | null
  linkTargets: ReadonlyMap<string, MarkdownLinkResolution>
  warn: (message: string) => void
}

/**
 * The link mark for one Markdown link, or null when the link is dropped (its
 * text is kept, and the warning says why). An entry in `linkTargets` becomes
 * an entry link. A path that is ambiguous there stays a plain link, with a
 * warning. An `entry:` href that no entry matches is dropped. Any other href
 * keeps the rules of isAllowedLinkHref.
 */
function linkMarkFor(href: string, ctx: Converter): Mark | null {
  const target = ctx.linkTargets.get(href)
  if (target && 'entryId' in target) {
    return {
      type: 'link',
      attrs: {
        href: target.href,
        entryId: target.entryId,
        collection: target.collection,
        anchor: target.anchor,
      },
    }
  }
  if (href.startsWith(ENTRY_HREF_PREFIX)) {
    ctx.warn(unknownEntryLinkWarning(href))
    return null
  }
  if (target) ctx.warn(ambiguousLinkWarning(href))
  if (isAllowedLinkHref(href)) return { type: 'link', attrs: { href } }
  ctx.warn(droppedLinkWarning(href))
  return null
}

const ASSET_SRC_PREFIX = 'asset:'
const MARK_ORDER: Record<Mark['type'], number> = {
  bold: 0,
  italic: 1,
  code: 2,
  link: 3,
}

function emptyDoc(): RichTextDoc {
  return { type: 'doc', content: [{ type: 'paragraph' }] }
}

function withMark(marks: Mark[], mark: Mark): Mark[] {
  if (marks.some((existing) => existing.type === mark.type)) return marks
  // Code takes no bold or italic: they yield to code in either order.
  const isEmphasis = mark.type === 'bold' || mark.type === 'italic'
  if (isEmphasis && marks.some((existing) => existing.type === 'code')) {
    return marks
  }
  const base =
    mark.type === 'code'
      ? marks.filter(
          (existing) => existing.type !== 'bold' && existing.type !== 'italic',
        )
      : marks
  return [...base, mark].sort((a, b) => MARK_ORDER[a.type] - MARK_ORDER[b.type])
}

function sameMarks(a: Mark[] | undefined, b: Mark[]): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b)
}

function pushText(out: Piece[], text: string, marks: Mark[]): void {
  if (text.length === 0) return
  const last = out.at(-1)
  if (
    last?.kind === 'inline' &&
    last.node.type === 'text' &&
    sameMarks(last.node.marks, marks)
  ) {
    last.node.text = `${last.node.text ?? ''}${text}`
    return
  }
  out.push({
    kind: 'inline',
    node: {
      type: 'text',
      text,
      ...(marks.length > 0 && { marks: marks.map((mark) => ({ ...mark })) }),
    },
  })
}

function imageNode(image: ImageNode, ctx: Converter): PMNode | undefined {
  let src = image.src.trim()
  if (src.startsWith(ASSET_SRC_PREFIX)) {
    const assetId = src.slice(ASSET_SRC_PREFIX.length)
    if (assetId.length === 0 || assetId.length > ID_MAX_LENGTH) return undefined
    if (/\s/.test(assetId)) return undefined
    const resolved = ctx.resolveAssetSrc(assetId)
    if (!resolved) return undefined
    src = resolved
  }
  if (!isAllowedImageSrc(src)) return undefined
  return {
    type: 'image',
    attrs: {
      src,
      alt: image.alt,
      title: image.title ?? null,
    },
  }
}

/** Flattens inline markdown into text/hardBreak nodes plus block-level images. */
function inlinePieces(
  nodes: InlineNode[],
  marks: Mark[],
  ctx: Converter,
  out: Piece[] = [],
): Piece[] {
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        pushText(out, node.value, marks)
        break
      case 'inlineCode':
        pushText(out, node.value, withMark(marks, { type: 'code' }))
        break
      case 'inlineHtml':
        // Raw HTML is not supported; keep its literal text.
        pushText(out, node.value, marks)
        break
      case 'strong':
        inlinePieces(node.children, withMark(marks, { type: 'bold' }), ctx, out)
        break
      case 'emphasis':
        inlinePieces(
          node.children,
          withMark(marks, { type: 'italic' }),
          ctx,
          out,
        )
        break
      case 'link': {
        const mark = linkMarkFor(node.href, ctx)
        inlinePieces(
          node.children,
          mark ? withMark(marks, mark) : marks,
          ctx,
          out,
        )
        break
      }
      case 'strike':
      case 'inlineComponent':
        inlinePieces(node.children, marks, ctx, out)
        break
      case 'image': {
        const image = imageNode(node, ctx)
        if (image) out.push({ kind: 'block', node: image })
        break
      }
      case 'break':
        out.push({ kind: 'inline', node: { type: 'hardBreak' } })
        break
      case 'footnoteReference':
        break
    }
  }
  return out
}

/** Groups inline runs into paragraphs; block images stay between them. */
function piecesToBlocks(pieces: Piece[]): PMNode[] {
  const blocks: PMNode[] = []
  let run: PMNode[] = []
  const flush = () => {
    const content = trimRun(run)
    if (content.length > 0) blocks.push({ type: 'paragraph', content })
    run = []
  }
  for (const piece of pieces) {
    if (piece.kind === 'inline') {
      run.push(piece.node)
    } else {
      flush()
      blocks.push(piece.node)
    }
  }
  flush()
  return blocks
}

/** Trims whitespace at the edges of a run that an image split exposed. */
function trimRun(run: PMNode[]): PMNode[] {
  const content = run.map((node) => ({ ...node }))
  const first = content.length > 0 ? content[0] : undefined
  if (first?.type === 'text') {
    first.text = (first.text ?? '').replace(/^\s+/, '')
  }
  const last = content.at(-1)
  if (last?.type === 'text') {
    last.text = (last.text ?? '').replace(/\s+$/, '')
  }
  return content.filter(
    (node) => node.type !== 'text' || (node.text ?? '').length > 0,
  )
}

function blocksOrPlaceholder(blocks: PMNode[]): PMNode[] {
  return blocks.length > 0 ? blocks : [{ type: 'paragraph' }]
}

function textParagraph(text: string): PMNode[] {
  const trimmed = text.trim()
  if (trimmed.length === 0) return []
  return [{ type: 'paragraph', content: [{ type: 'text', text: trimmed }] }]
}

function clampHeadingLevel(depth: number): number {
  return Math.min(4, Math.max(2, depth))
}

function cellNode(
  type: 'tableHeader' | 'tableCell',
  cell: TableCellNode | undefined,
  ctx: Converter,
): PMNode {
  const blocks = cell
    ? piecesToBlocks(inlinePieces(cell.children, [], ctx))
    : []
  return { type, content: blocksOrPlaceholder(blocks) }
}

function tableNodes(table: TableNode, ctx: Converter): PMNode[] {
  const header = table.header.map((cell) => cellNode('tableHeader', cell, ctx))
  const body = table.rows.map((row) =>
    row.map((cell) => cellNode('tableCell', cell, ctx)),
  )
  // Ragged rows are padded so every row has the same width.
  const columns = [header.length, ...body.map((row) => row.length), 1].reduce(
    (max, length) => Math.max(max, length),
    0,
  )
  const pad = (cells: PMNode[], type: 'tableHeader' | 'tableCell') => {
    const padded = [...cells]
    while (padded.length < columns) padded.push(cellNode(type, undefined, ctx))
    return padded
  }
  return [
    {
      type: 'table',
      content: [
        { type: 'tableRow', content: pad(header, 'tableHeader') },
        ...body.map((row) => ({
          type: 'tableRow',
          content: pad(row, 'tableCell'),
        })),
      ],
    },
  ]
}

function listItemNode(item: ListItemNode, ctx: Converter): PMNode {
  const children = convertBlocks(item.children, ctx)
  // TipTap list items must open with a paragraph.
  if (children.length === 0 || children[0].type !== 'paragraph') {
    children.unshift({ type: 'paragraph' })
  }
  return { type: 'listItem', content: children }
}

function listNodes(
  list: { ordered: boolean; start?: number; items: ListItemNode[] },
  ctx: Converter,
): PMNode[] {
  if (list.items.length === 0) return []
  const items = list.items.map((item) => listItemNode(item, ctx))
  if (!list.ordered) return [{ type: 'bulletList', content: items }]
  const start = list.start
  return [
    {
      type: 'orderedList',
      ...(start !== undefined && start !== 1 && { attrs: { start } }),
      content: items,
    },
  ]
}

function blockNodes(block: BlockNode, ctx: Converter): PMNode[] {
  switch (block.type) {
    case 'heading': {
      const pieces = inlinePieces(block.children, [], ctx)
      const content = pieces.flatMap((piece) =>
        piece.kind === 'inline' ? [piece.node] : [],
      )
      const images = pieces.flatMap((piece) =>
        piece.kind === 'block' ? [piece.node] : [],
      )
      const level = clampHeadingLevel(block.depth)
      return [
        {
          type: 'heading',
          attrs: { level },
          ...(content.length > 0 && { content: trimRun(content) }),
        },
        ...images,
      ]
    }
    case 'paragraph':
      return piecesToBlocks(inlinePieces(block.children, [], ctx))
    case 'code': {
      const language = normalizeCodeLanguage(block.lang)
      return [
        {
          type: 'codeBlock',
          ...(language && { attrs: { language } }),
          ...(block.value.length > 0 && {
            content: [{ type: 'text', text: block.value }],
          }),
        },
      ]
    }
    case 'list':
      return listNodes(block, ctx)
    case 'blockquote':
      return [
        {
          type: 'blockquote',
          content: blocksOrPlaceholder(convertBlocks(block.children, ctx)),
        },
      ]
    case 'table':
      return tableNodes(block, ctx)
    case 'thematicBreak':
      return [{ type: 'horizontalRule' }]
    case 'html':
      // Raw HTML is never stored; its text survives as a plain paragraph.
      return textParagraph(block.value)
    case 'callout': {
      const title = textParagraph(block.title)
      return [...title, ...convertBlocks(block.children, ctx)]
    }
    case 'component':
      return convertBlocks(block.children, ctx)
    case 'footnotes':
      return block.items.flatMap((item) => convertBlocks(item.children, ctx))
    default:
      return []
  }
}

function convertBlocks(blocks: BlockNode[], ctx: Converter): PMNode[] {
  return blocks.flatMap((block) => blockNodes(block, ctx))
}

/**
 * Converts Markdown (as written by AI agents) into a TipTap document that the
 * CMS validator accepts. Unsupported constructs degrade to plain text; raw HTML
 * is never emitted. Images are only kept when their `src` is an allowed asset
 * or http(s) URL, and `asset:<id>` references go through `resolveAssetSrc`.
 */
export function markdownToRichText(
  markdown: string,
  options: MarkdownToRichTextOptions = {},
): RichTextDoc {
  if (markdown.trim().length === 0) return emptyDoc()
  const ctx: Converter = {
    resolveAssetSrc: options.resolveAssetSrc ?? (() => null),
    linkTargets: options.linkTargets ?? new Map(),
    warn: (message) => options.onWarning?.(message),
  }
  const document = parseMarkdown(markdown, {
    frontmatter: false,
    // The default transform blanks every non-http(s) scheme, which would
    // erase `asset:` references before they can be resolved. Images keep the
    // `asset:` form. Links keep their href as written: linkMarkFor decides
    // what each one becomes, on the raw href (the default sanitizer would
    // silently strip spaces from it).
    urlTransform: (url, kind, defaultUrl) => {
      if (kind === 'image') {
        return url.trim().startsWith(ASSET_SRC_PREFIX) ? url.trim() : defaultUrl
      }
      options.onLink?.(url)
      return url
    },
  })
  return {
    type: 'doc',
    content: blocksOrPlaceholder(convertBlocks(document.children, ctx)),
  }
}

/**
 * Serializes a stored TipTap document back to Markdown for reading. Entry
 * links are written `entry:<id>` (see serializeMarkdown for the other form).
 */
export function richTextToMarkdown(
  doc: unknown,
  options?: Parameters<typeof serializeMarkdown>[1],
): string {
  return serializeMarkdown(doc, options)
}

/**
 * Accepts either a Markdown string (converted) or an already-built document
 * (returned as-is). Anything else is returned unchanged so the validator can
 * reject it with its usual messages.
 */
export function normalizeRichTextInput(
  value: unknown,
  options?: MarkdownToRichTextOptions,
): unknown {
  if (typeof value === 'string' && value.length > 0) {
    return markdownToRichText(value, options)
  }
  return value
}
