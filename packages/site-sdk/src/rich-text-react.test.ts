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
  it('opens external links in a new tab and keeps site paths, anchors and mailto in place', () => {
    const links: MarkdownDocument = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'link',
              href: 'https://example.com/guide',
              children: [{ type: 'text', value: 'External' }],
            },
            { type: 'text', value: ' ' },
            {
              type: 'link',
              href: 'http://example.org',
              children: [{ type: 'text', value: 'Plain http' }],
            },
            { type: 'text', value: ' ' },
            {
              type: 'link',
              href: '/coffees/ethiopia#origin',
              children: [{ type: 'text', value: 'Internal' }],
            },
            { type: 'text', value: ' ' },
            {
              type: 'link',
              href: '#faq',
              children: [{ type: 'text', value: 'Anchor' }],
            },
            { type: 'text', value: ' ' },
            {
              type: 'link',
              href: 'mailto:hello@example.com',
              children: [{ type: 'text', value: 'Mail' }],
            },
          ],
        },
      ],
    }
    const html = renderToStaticMarkup(
      createElement(Markdown, {
        components: richTextComponents(),
        children: links,
      }),
    )
    expect(html).toContain(
      '<a href="https://example.com/guide" target="_blank" rel="noopener noreferrer">External</a>',
    )
    expect(html).toContain(
      '<a href="http://example.org" target="_blank" rel="noopener noreferrer">Plain http</a>',
    )
    expect(html).toContain('<a href="/coffees/ethiopia#origin">Internal</a>')
    expect(html).toContain('<a href="#faq">Anchor</a>')
    expect(html).toContain('<a href="mailto:hello@example.com">Mail</a>')
  })

  it('passes target and rel to a custom link component for external links only', () => {
    const components = richTextComponents({
      a(props) {
        return createElement('a', { ...props, className: 'site-link' })
      },
    })
    const links: MarkdownDocument = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'link',
              href: 'https://example.com',
              children: [{ type: 'text', value: 'Site' }],
            },
            { type: 'text', value: ' ' },
            {
              type: 'link',
              href: '/coffees',
              children: [{ type: 'text', value: 'Page' }],
            },
          ],
        },
      ],
    }
    const html = renderToStaticMarkup(
      createElement(Markdown, { components, children: links }),
    )
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('target="_blank" rel="noopener noreferrer"')
    expect(html).toContain('class="site-link"')
    expect(html).toContain('href="/coffees" class="site-link">Page</a>')
    expect(html.match(/target=/g)).toHaveLength(1)
  })
})
