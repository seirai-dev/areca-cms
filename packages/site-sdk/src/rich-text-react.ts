import { createElement } from 'react'
import type {
  MarkdownComponents,
  MarkdownComponentProps,
} from '@tanstack/markdown/react'

/** True for `http(s)` links to another site. Site paths, anchors and `mailto:` are not. */
function isExternalHref(href: string | undefined): boolean {
  if (!href) return false
  try {
    const { protocol } = new URL(href)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Component map for `<Markdown>`. External `http(s)` links open in a new tab
 * with `rel="noopener noreferrer"`. Site paths, anchors and `mailto:` links are
 * rendered as written. Images keep their editor dimensions and render without
 * void-element children.
 *
 * A custom `a` or `img` in `components` still renders the link or image. The
 * SDK passes it the same `target` and `rel`, so a site can restyle links
 * without losing the new-tab behaviour.
 */
export function richTextComponents(
  components: MarkdownComponents = {},
): MarkdownComponents {
  const link = components.a ?? 'a'
  const image = components.img ?? 'img'
  return {
    ...components,
    a({ children, ...props }: MarkdownComponentProps<'a'>) {
      return createElement(
        link,
        isExternalHref(props.href)
          ? { ...props, target: '_blank', rel: 'noopener noreferrer' }
          : props,
        children,
      )
    },
    img({ children: _children, ...props }: MarkdownComponentProps<'img'>) {
      return createElement(image, props)
    },
  }
}
