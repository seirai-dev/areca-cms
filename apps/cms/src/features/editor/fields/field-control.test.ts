import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { FieldControl } from './field-control'

function attr(html: string, tag: string, name: string) {
  const match = html.match(new RegExp(`<${tag}\\b[^>]*\\s${name}="([^"]*)"`))
  return match?.[1]
}

describe('FieldControl', () => {
  it('renders a textarea for textarea fields, not a text input', () => {
    const html = renderToStaticMarkup(
      createElement(FieldControl, {
        field: { key: 'bio', label: 'Bio', type: 'textarea' },
        value: 'Hello',
        onChange: () => {},
        siteId: 'site-1',
        organizationId: 'org-1',
      }),
    )
    expect(html).toContain('<textarea')
    expect(html).not.toMatch(/<input\b/)
  })

  it('associates required and error state on a textarea', () => {
    const html = renderToStaticMarkup(
      createElement(FieldControl, {
        field: {
          key: 'bio',
          label: 'Bio',
          type: 'textarea',
          required: true,
        },
        value: '',
        onChange: () => {},
        error: 'Bio is required',
        siteId: 'site-1',
        organizationId: 'org-1',
      }),
    )
    expect(attr(html, 'textarea', 'aria-required')).toBe('true')
    expect(attr(html, 'textarea', 'aria-invalid')).toBe('true')
    expect(attr(html, 'textarea', 'aria-describedby')).toBe('field-bio-error')
    expect(html).toContain('id="field-bio-error"')
    expect(html).toContain('role="alert"')
  })
})
