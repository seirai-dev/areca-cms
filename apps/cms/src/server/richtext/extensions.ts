import type { Extensions } from '@tiptap/core'
import { Image } from '@tiptap/extension-image'
import { Link } from '@tiptap/extension-link'
import { StarterKit } from '@tiptap/starter-kit'

import { isAllowedLinkHref } from './allowlist'

export const richTextExtensions: Extensions = [
  StarterKit.configure({
    heading: { levels: [2, 3, 4] },
    code: false,
    strike: false,
    underline: false,
    link: false,
    trailingNode: false,
  }),
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
  }),
]
