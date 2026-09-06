import {
  ALLOWED_MARK_TYPES,
  ALLOWED_NODE_TYPES,
  isAllowedImageSrc,
  isAllowedLinkHref,
  isDisallowedAttrKey,
} from './allowlist'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function checkAttrs(attrs: unknown, errors: string[]): Record<string, unknown> | undefined {
  if (attrs === undefined) return undefined
  if (!isPlainObject(attrs)) {
    errors.push('Attributes must be an object')
    return undefined
  }
  for (const key of Object.keys(attrs)) {
    if (isDisallowedAttrKey(key)) {
      errors.push(`Attribute "${key}" is not allowed`)
    }
  }
  return attrs
}

function walkMark(mark: unknown, errors: string[]): void {
  if (!isPlainObject(mark)) {
    errors.push('Mark must be an object')
    return
  }
  const type = mark.type
  if (typeof type !== 'string') {
    errors.push('Mark is missing a type')
    return
  }
  if (!ALLOWED_MARK_TYPES.has(type)) {
    errors.push(`Unknown mark type "${type}"`)
  }
  const attrs = checkAttrs(mark.attrs, errors)
  if (type === 'link') {
    const href = attrs?.href
    if (typeof href !== 'string' || !isAllowedLinkHref(href)) {
      errors.push('Link href uses a disallowed protocol')
    }
  }
}

function walkNode(node: unknown, errors: string[], isRoot = false): void {
  if (!isPlainObject(node)) {
    errors.push(isRoot ? 'Rich text must be an object' : 'Node must be an object')
    return
  }

  const type = node.type
  if (typeof type !== 'string') {
    errors.push('Node is missing a type')
    return
  }

  if (isRoot && type !== 'doc') {
    errors.push('Root type must be "doc"')
  }

  if (!ALLOWED_NODE_TYPES.has(type)) {
    errors.push(`Unknown node type "${type}"`)
  }

  const attrs = checkAttrs(node.attrs, errors)

  if (type === 'heading') {
    const level = attrs?.level
    if (typeof level !== 'number' || level < 2 || level > 4) {
      errors.push('Heading level must be between 2 and 4')
    }
  }

  if (type === 'image') {
    const src = attrs?.src
    if (typeof src !== 'string' || !isAllowedImageSrc(src)) {
      errors.push('Image src is not allowed')
    }
  }

  if (node.marks !== undefined) {
    if (!Array.isArray(node.marks)) {
      errors.push('Marks must be an array')
    } else {
      for (const mark of node.marks) walkMark(mark, errors)
    }
  }

  if (node.content !== undefined) {
    if (!Array.isArray(node.content)) {
      errors.push('Content must be an array')
    } else {
      for (const child of node.content) walkNode(child, errors)
    }
  }
}

export function validateRichText(json: unknown): string[] {
  const errors: string[] = []
  walkNode(json, errors, true)
  return errors
}
