import type { Extensions } from '@tiptap/core'
import { CodeBlock } from '@tiptap/extension-code-block'
import { Code } from '@tiptap/extension-code'
import { Image } from '@tiptap/extension-image'
import { Link } from '@tiptap/extension-link'
import { TableKit } from '@tiptap/extension-table'
import { StarterKit } from '@tiptap/starter-kit'

import { isAllowedLinkHref } from './allowlist'

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
  Link.configure({
    openOnClick: false,
    protocols: ['http', 'https', 'mailto'],
    HTMLAttributes: {
      rel: 'noopener noreferrer',
      target: '_blank',
    },
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
