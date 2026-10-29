import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { useLivePreview } from './visual-react.js'

function Title(props: { cmsOrigin: string | null | undefined }) {
  const title = useLivePreview({
    initial: 'Published title',
    cmsOrigin: props.cmsOrigin,
    resolve: () => 'Draft title',
  })
  return createElement('h1', null, title)
}

describe('useLivePreview', () => {
  it('renders the initial value on the server, before any CMS update', () => {
    expect(renderToStaticMarkup(createElement(Title, { cmsOrigin: 'https://cms.test' }))).toBe(
      '<h1>Published title</h1>',
    )
  })

  it('renders the initial value when there is no CMS origin', () => {
    expect(renderToStaticMarkup(createElement(Title, { cmsOrigin: null }))).toBe(
      '<h1>Published title</h1>',
    )
    expect(renderToStaticMarkup(createElement(Title, { cmsOrigin: undefined }))).toBe(
      '<h1>Published title</h1>',
    )
  })
})
