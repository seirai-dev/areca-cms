import { createElement, createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { EditorCanvas } from './editor-canvas'

function attr(html: string, tag: string, name: string) {
  const match = html.match(new RegExp(`<${tag}\\b[^>]*\\s${name}="([^"]*)"`))
  return match?.[1]
}

describe('EditorCanvas', () => {
  it('associates the title error via aria-describedby', () => {
    const html = renderToStaticMarkup(
      createElement(EditorCanvas, {
        titleField: {
          key: 'title',
          label: 'Title',
          type: 'text',
          required: true,
        },
        canvasFields: [],
        data: { title: '' },
        errors: { title: 'Title is required' },
        onChange: () => {},
        organizationId: 'org-1',
        linkContext: {
          siteId: 'site-1',
          entryId: null,
          locale: null,
          devSite: false,
        },
        previewing: false,
        titleRef: createRef<HTMLTextAreaElement>(),
      }),
    )
    expect(attr(html, 'textarea', 'aria-required')).toBe('true')
    expect(attr(html, 'textarea', 'aria-invalid')).toBe('true')
    expect(attr(html, 'textarea', 'aria-describedby')).toBe('field-title-error')
    expect(html).toContain('id="field-title-error"')
    expect(html).toContain('role="alert"')
  })
})
