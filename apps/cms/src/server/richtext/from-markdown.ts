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
import { serializeMarkdown } from './markdown'

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
}

type Mark =
  | { type: 'bold' }
  | { type: 'italic' }
  | { type: 'code' }
  | { type: 'link'; attrs: { href: string } }

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
      case 'link':
        inlinePieces(
          node.children,
          isAllowedLinkHref(node.href)
            ? withMark(marks, { type: 'link', attrs: { href: node.href } })
            : marks,
          ctx,
          out,
        )
        break
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
  }
  const document = parseMarkdown(markdown, {
    frontmatter: false,
    // The default transform blanks every non-http(s) scheme, which would
    // erase `asset:` references before they can be resolved. Only image
    // sources are exempt; links keep the default (javascript: etc. blanked).
    urlTransform: (url, kind, defaultUrl) =>
      kind === 'image' && url.trim().startsWith(ASSET_SRC_PREFIX)
        ? url.trim()
        : defaultUrl,
  })
  return {
    type: 'doc',
    content: blocksOrPlaceholder(convertBlocks(document.children, ctx)),
  }
}

/** Serializes a stored TipTap document back to Markdown for reading. */
export function richTextToMarkdown(doc: unknown): string {
  return serializeMarkdown(doc)
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
