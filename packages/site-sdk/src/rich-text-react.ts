import { createElement } from 'react'
import type {
  MarkdownComponents,
  MarkdownComponentProps,
} from '@tanstack/markdown/react'

/** Keep editor image dimensions while rendering TanStack's void img components safely. */
export function richTextComponents(
  components: MarkdownComponents = {},
): MarkdownComponents {
  const image = components.img ?? 'img'
  return {
    ...components,
    img({ children: _children, ...props }: MarkdownComponentProps<'img'>) {
      return createElement(image, props)
    },
  }
}
