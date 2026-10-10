import {
  RICHTEXT_MAX_DEPTH,
  RICHTEXT_MAX_ERRORS,
  RICHTEXT_MAX_MARKS_PER_NODE,
  RICHTEXT_MAX_NODES,
  RICHTEXT_MAX_TEXT_LENGTH,
} from '#/lib/content-limits'

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

function checkAttrs(
  attrs: unknown,
  errors: string[],
): Record<string, unknown> | undefined {
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

function checkMark(mark: unknown, errors: string[]): void {
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

/** Checks one node (not its children); pushes child nodes onto `children`. */
function checkNode(
  node: unknown,
  isRoot: boolean,
  errors: string[],
): { children: unknown[]; textLength: number } {
  const none = { children: [] as unknown[], textLength: 0 }
  if (!isPlainObject(node)) {
    errors.push(
      isRoot ? 'Rich text must be an object' : 'Node must be an object',
    )
    return none
  }

  const type = node.type
  if (typeof type !== 'string') {
    errors.push('Node is missing a type')
    return none
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
    for (const dimension of ['width', 'height'] as const) {
      const value = attrs?.[dimension]
      if (
        value !== undefined &&
        value !== null &&
        (typeof value !== 'number' ||
          !Number.isFinite(value) ||
          value <= 0 ||
          value > 10000)
      ) {
        errors.push(
          `Image ${dimension} must be a positive number no greater than 10000`,
        )
      }
    }
  }

  if (node.marks !== undefined) {
    if (!Array.isArray(node.marks)) {
      errors.push('Marks must be an array')
    } else if (node.marks.length > RICHTEXT_MAX_MARKS_PER_NODE) {
      errors.push(
        `A node can have at most ${RICHTEXT_MAX_MARKS_PER_NODE} marks`,
      )
    } else {
      for (const mark of node.marks) checkMark(mark, errors)
    }
  }

  let children: unknown[] = []
  if (node.content !== undefined) {
    if (!Array.isArray(node.content)) {
      errors.push('Content must be an array')
    } else {
      children = node.content
    }
  }
  const textLength = typeof node.text === 'string' ? node.text.length : 0
  return { children, textLength }
}

/**
 * Validate a rich text document. Iterative on purpose: the payload is
 * attacker-controlled, so recursion depth must never follow its nesting.
 * Depth, node count, text length and error count are all bounded.
 */
export function validateRichText(json: unknown): string[] {
  const errors: string[] = []
  const stack: Array<{ node: unknown; depth: number }> = [
    { node: json, depth: 1 },
  ]
  let nodes = 0
  let textLength = 0

  while (stack.length > 0) {
    if (errors.length >= RICHTEXT_MAX_ERRORS) break
    const { node, depth } = stack.pop()!
    nodes += 1
    if (nodes > RICHTEXT_MAX_NODES) {
      errors.push(`Rich text has more than ${RICHTEXT_MAX_NODES} nodes`)
      break
    }
    if (depth > RICHTEXT_MAX_DEPTH) {
      errors.push(
        `Rich text is nested deeper than ${RICHTEXT_MAX_DEPTH} levels`,
      )
      break
    }
    const result = checkNode(node, depth === 1, errors)
    textLength += result.textLength
    if (textLength > RICHTEXT_MAX_TEXT_LENGTH) {
      errors.push(
        `Rich text is longer than ${RICHTEXT_MAX_TEXT_LENGTH} characters`,
      )
      break
    }
    if (nodes + stack.length + result.children.length > RICHTEXT_MAX_NODES) {
      errors.push(`Rich text has more than ${RICHTEXT_MAX_NODES} nodes`)
      break
    }
    // Reverse so siblings pop in document order.
    for (let i = result.children.length - 1; i >= 0; i--) {
      stack.push({ node: result.children[i], depth: depth + 1 })
    }
  }
  return errors
}
