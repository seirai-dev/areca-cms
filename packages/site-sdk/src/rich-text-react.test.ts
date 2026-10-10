import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown } from '@tanstack/markdown/react'
import type { MarkdownDocument } from '@tanstack/markdown'
import { richTextComponents } from './rich-text-react.js'

const document: MarkdownDocument = {
  type: 'root',
  children: [
    {
      type: 'paragraph',
      children: [
        {
          type: 'inlineComponent',
          name: 'img',
          tagName: 'img',
          attributes: {},
          children: [],
          properties: {
            src: 'https://site.test/image.png?a=1&b=2',
            alt: 'Literal "alt" <x>',
            title: 'a "title"',
            width: '240',
            height: '120',
          },
        },
      ],
    },
  ],
}

describe('rich-text React adapter', () => {
  it('renders sized image components without void-element children and escapes attributes', () => {
    const html = renderToStaticMarkup(
      createElement(Markdown, {
        components: richTextComponents(),
        children: document,
      }),
    )
    expect(html).toContain('width="240" height="120"')
    expect(html).toContain('src="https://site.test/image.png?a=1&amp;b=2"')
    expect(html).toContain('alt="Literal &quot;alt&quot; &lt;x&gt;"')
    expect(html).not.toContain('</img>')
  })
  it('preserves custom image rendering and passes dimensions without generated children', () => {
    const components = richTextComponents({
      img(props) {
        expect(props.children).toBeUndefined()
        return createElement('img', {
          ...props,
          loading: 'lazy',
          className: 'custom-image',
        })
      },
    })
    const html = renderToStaticMarkup(
      createElement(Markdown, { components, children: document }),
    )
    expect(html).toContain('class="custom-image"')
    expect(html).toContain('width="240" height="120"')
  })
  it('keeps ordinary image nodes compatible with the same adapter', () => {
    const plain: MarkdownDocument = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'image', src: 'https://site.test/plain.png', alt: 'Plain' },
          ],
        },
      ],
    }
    const html = renderToStaticMarkup(
      createElement(Markdown, {
        components: richTextComponents(),
        children: plain,
      }),
    )
    expect(html).toContain('alt="Plain"')
    expect(html).not.toContain('width=')
  })
})
