import { mergeAttributes } from '@tiptap/core'
import type { Extensions } from '@tiptap/core'
import { CodeBlock } from '@tiptap/extension-code-block'
import { Code } from '@tiptap/extension-code'
import { Image } from '@tiptap/extension-image'
import { Link } from '@tiptap/extension-link'
import { TableKit } from '@tiptap/extension-table'
import { StarterKit } from '@tiptap/starter-kit'

import { isAllowedLinkHref, isInternalHref } from './allowlist'

export const richTextExtensions: Extensions = [
  StarterKit.configure({
    heading: { levels: [2, 3, 4] },
    // Inline code is added below so it can exclude bold and italic.
    code: false,
    // Code blocks are added below so the editor can swap in its own version
    // (same node name and attributes) without a duplicate extension name.
    codeBlock: false,
    strike: false,
    underline: false,
    link: false,
    trailingNode: false,
  }),
  // Code spans take no bold or italic, but may sit inside a link.
  Code.extend({ excludes: 'bold italic' }),
  CodeBlock,
  // External links open in a new tab; site paths and anchors stay in this one.
  // The base Link supplies target and rel as attribute defaults, so they are
  // stripped here for internal hrefs. The parent renderHTML is not used.
  Link.extend({
    renderHTML({ HTMLAttributes }) {
      const { rel: _rel, target: _target, ...rest } = HTMLAttributes
      // Keep the base Link's safety net: a disallowed href renders empty.
      const raw = typeof rest.href === 'string' ? rest.href : ''
      const href = isAllowedLinkHref(raw) ? raw : ''
      const attributes = isInternalHref(href)
        ? { ...rest, href }
        : { ...rest, href, rel: 'noopener noreferrer', target: '_blank' }
      return ['a', mergeAttributes(attributes), 0]
    },
  }).configure({
    openOnClick: false,
    protocols: ['http', 'https', 'mailto'],
    HTMLAttributes: {},
    isAllowedUri: (url) => Boolean(url) && isAllowedLinkHref(url),
  }),
  Image.configure({
    allowBase64: false,
    resize: {
      enabled: true,
      minWidth: 80,
      minHeight: 40,
      alwaysPreserveAspectRatio: true,
    },
  }),
  TableKit.configure({
    table: {
      resizable: true,
      lastColumnResizable: true,
      allowTableNodeSelection: true,
    },
  }),
]
