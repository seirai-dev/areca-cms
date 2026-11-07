import type { JSONContent } from '@tiptap/core'
import type {
  BlockNode,
  ComponentNode,
  InlineNode,
  MarkdownDocument,
  TableCellNode,
} from '@tanstack/markdown'

import { createHeadingIds } from './heading-ids'

/** Convert validated editor nodes directly; Markdown syntax never interprets literal text. */
export function richTextDocumentFromJson(json: JSONContent): MarkdownDocument {
  const headingIdFor = createHeadingIds()
  function headingId(node: JSONContent): string {
    return headingIdFor(
      (node.content ?? []).map((child) => child.text ?? '').join(''),
    )
  }
  function inline(nodes: JSONContent[] = []): InlineNode[] {
    return nodes.flatMap((node): InlineNode[] => {
      if (node.type === 'hardBreak') return [{ type: 'break' }]
      if (node.type === 'image') {
        const properties: Record<string, string> = {
          src: String(node.attrs?.src ?? ''),
          alt: String(node.attrs?.alt ?? ''),
          ...(typeof node.attrs?.title === 'string'
            ? { title: node.attrs.title }
            : {}),
        }
        for (const key of ['width', 'height'] as const) {
          const dimension = node.attrs?.[key]
          if (
            typeof dimension === 'number' &&
            Number.isFinite(dimension) &&
            dimension > 0 &&
            dimension <= 10000
          )
            properties[key] = String(dimension)
        }
        if (properties.width || properties.height)
          return [
            {
              type: 'inlineComponent',
              name: 'img',
              tagName: 'img',
              attributes: {},
              properties,
              children: [],
            },
          ]
        return [{ type: 'image', ...properties } as InlineNode]
      }
      if (node.type !== 'text') return inline(node.content)
      const isCode = node.marks?.some((mark) => mark.type === 'code')
      let value: InlineNode = isCode
        ? { type: 'inlineCode', value: node.text ?? '' }
        : { type: 'text', value: node.text ?? '' }
      // Code takes no bold or italic (same rule as the editor and Markdown export).
      if (!isCode && node.marks?.some((mark) => mark.type === 'italic'))
        value = { type: 'emphasis', children: [value] }
      if (!isCode && node.marks?.some((mark) => mark.type === 'bold'))
        value = { type: 'strong', children: [value] }
      const link = node.marks?.find((mark) => mark.type === 'link')
      if (link)
        value = {
          type: 'link',
          href: String(link.attrs?.href ?? ''),
          // Entry links keep the id, so sites and the SDK can find them.
          ...(typeof link.attrs?.entryId === 'string'
            ? { entryId: link.attrs.entryId }
            : {}),
          // The language the target's path is in (set by the snapshot).
          ...(typeof link.attrs?.locale === 'string'
            ? { locale: link.attrs.locale }
            : {}),
          children: [value],
        }
      return [value]
    })
  }
  function component(
    tagName: string,
    children: BlockNode[],
    properties: Record<string, string> = {},
  ): ComponentNode {
    return {
      type: 'component',
      name: tagName,
      tagName,
      attributes: {},
      properties,
      children,
    }
  }
  function table(node: JSONContent): BlockNode {
    const rows = node.content ?? []
    // Plain Markdown tables are retained for simple tables and existing renderer customization.
    const simple = rows.every((row, index) =>
      (row.content ?? []).every(
        (cell) =>
          cell.type === (index === 0 ? 'tableHeader' : 'tableCell') &&
          (cell.content?.length ?? 0) <= 1 &&
          (!cell.content?.[0] || cell.content[0].type === 'paragraph') &&
          (!cell.attrs?.colspan || cell.attrs.colspan === 1) &&
          (!cell.attrs?.rowspan || cell.attrs.rowspan === 1),
      ),
    )
    if (simple) {
      const cells = (row?: JSONContent): TableCellNode[] =>
        (row?.content ?? []).map((cell) => ({
          type: 'tableCell',
          children: inline(cell.content?.[0]?.content),
        }))
      return {
        type: 'table',
        align: [],
        header: cells(rows[0]),
        rows: rows.slice(1).map(cells),
      }
    }
    // Public component nodes preserve mixed headers, merged cells and block content.
    return component('table', [
      component(
        'tbody',
        rows.map((row) =>
          component(
            'tr',
            (row.content ?? []).map((cell) => {
              const props: Record<string, string> = {}
              for (const [source, property] of [
                ['colspan', 'colSpan'],
                ['rowspan', 'rowSpan'],
              ] as const) {
                const span = cell.attrs?.[source]
                if (Number.isInteger(span) && span > 1 && span <= 1000)
                  props[property] = String(span)
              }
              return component(
                cell.type === 'tableHeader' ? 'th' : 'td',
                blocks(cell.content),
                props,
              )
            }),
          ),
        ),
      ),
    ])
  }
  function block(node: JSONContent): BlockNode {
    switch (node.type) {
      case 'heading':
        return {
          type: 'heading',
          depth: node.attrs?.level as 2 | 3 | 4,
          id: headingId(node),
          children: inline(node.content),
        }
      case 'paragraph':
      case 'image':
        return {
          type: 'paragraph',
          children: inline(node.type === 'image' ? [node] : node.content),
        }
      case 'horizontalRule':
        return { type: 'thematicBreak' }
      case 'codeBlock':
        return {
          type: 'code',
          value: (node.content ?? []).map((child) => child.text ?? '').join(''),
          ...(typeof node.attrs?.language === 'string' && node.attrs.language
            ? { lang: node.attrs.language }
            : {}),
        }
      case 'blockquote':
        return { type: 'blockquote', children: blocks(node.content) }
      case 'bulletList':
      case 'orderedList':
        return {
          type: 'list',
          ordered: node.type === 'orderedList',
          ...(node.type === 'orderedList'
            ? {
                start:
                  typeof node.attrs?.start === 'number' ? node.attrs.start : 1,
              }
            : {}),
          loose: (node.content ?? []).some(
            (item) =>
              (item.content ?? []).filter((child) => child.type === 'paragraph')
                .length > 1,
          ),
          items: (node.content ?? []).map((item) => ({
            type: 'listItem',
            children: blocks(item.content),
          })),
        }
      case 'table':
        return table(node)
      default:
        return { type: 'paragraph', children: inline(node.content) }
    }
  }
  function blocks(nodes: JSONContent[] = []): BlockNode[] {
    return nodes.map(block)
  }
  return { type: 'root', children: blocks(json.content) }
}
