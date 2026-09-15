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

function wrapMarks(text: string, marks: Mark[] | undefined): string {
  if (!marks?.length) return text
  let out = text
  if (marks.some((mark) => mark.type === 'italic')) out = `_${out}_`
  if (marks.some((mark) => mark.type === 'bold')) out = `**${out}**`
  const link = marks.find((mark) => mark.type === 'link')
  if (link) {
    const href = typeof link.attrs?.href === 'string' ? link.attrs.href : ''
    out = `[${out}](${href})`
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
  if (node.type === 'text') return wrapMarks(node.text ?? '', node.marks)
  if (node.content) return serializeInline(node.content)
  return ''
}

function serializeList(node: PMNode, ordered: boolean, indent: number): string {
  const items = node.content ?? []
  const start = typeof node.attrs?.start === 'number' ? node.attrs.start : 1
  return items
    .map((item, index) => serializeListItem(item, ordered, start + index, indent))
    .join('\n')
}

function serializeListItem(item: PMNode, ordered: boolean, number: number, indent: number): string {
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
      const language = typeof node.attrs?.language === 'string' ? node.attrs.language : ''
      const code = (node.content ?? []).map((child) => child.text ?? '').join('')
      return `\`\`\`${language}\n${code}\n\`\`\``
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
      return `![${alt}](${src})`
    }
    default:
      return serializeInline(node.content)
  }
}

export function serializeMarkdown(json: unknown): string {
  return serializeBlock(asNode(json)).trim()
}

const BLOCK_JOIN = new Set([
  'doc',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
])

function extractPlain(node: PMNode): string {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'hardBreak') return '\n'
  if (node.type === 'image') return typeof node.attrs?.alt === 'string' ? node.attrs.alt : ''
  if (node.type === 'horizontalRule') return ''
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
