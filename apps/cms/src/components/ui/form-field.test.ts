import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { FormField } from './form-field'

function attr(html: string, tag: string, name: string) {
  const match = html.match(new RegExp(`<${tag}\\b[^>]*\\s${name}="([^"]*)"`))
  return match?.[1]
}

describe('FormField', () => {
  it('exposes required state on the control', () => {
    const html = renderToStaticMarkup(
      createElement(FormField, {
        label: 'Title',
        htmlFor: 'title',
        required: true,
        children: createElement('input', { id: 'title' }),
      }),
    )
    expect(attr(html, 'input', 'aria-required')).toBe('true')
    expect(html).not.toContain('aria-invalid')
  })

  it('associates the error via aria-describedby and marks the control invalid', () => {
    const html = renderToStaticMarkup(
      createElement(FormField, {
        label: 'Title',
        htmlFor: 'title',
        required: true,
        error: 'Title is required',
        children: createElement('input', { id: 'title' }),
      }),
    )
    expect(attr(html, 'input', 'aria-required')).toBe('true')
    expect(attr(html, 'input', 'aria-invalid')).toBe('true')
    expect(attr(html, 'input', 'aria-describedby')).toBe('title-error')
    expect(html).toContain('id="title-error"')
    expect(html).toContain('role="alert"')
  })

  it('includes the description id in aria-describedby', () => {
    const html = renderToStaticMarkup(
      createElement(FormField, {
        label: 'Title',
        htmlFor: 'title',
        description: 'Shown on the site',
        error: 'Title is required',
        children: createElement('input', { id: 'title' }),
      }),
    )
    expect(attr(html, 'input', 'aria-describedby')).toBe(
      'title-description title-error',
    )
    expect(html).toContain('id="title-description"')
  })
})
