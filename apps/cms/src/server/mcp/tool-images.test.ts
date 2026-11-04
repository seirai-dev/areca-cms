import { describe, expect, it } from 'vitest'

import { withSiteEcho } from './agency-call'
import type { SiteEcho } from './agency-call'
import { ResultWithImages, toCallResult } from './tool-kit'

const image = { data: 'aGVsbG8=', mimeType: 'image/jpeg' }

describe('tool results with images', () => {
  it('sends the JSON first, then one image block per image', () => {
    const result = toCallResult(
      new ResultWithImages({ assetId: 'a1' }, [image]),
    )
    expect(result.content).toHaveLength(2)
    expect(result.content[0]).toMatchObject({ type: 'text' })
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({
      assetId: 'a1',
    })
    expect(result.content[1]).toEqual({ type: 'image', ...image })
  })

  it('keeps the images when the agency connector adds the site echo', () => {
    const echo: SiteEcho = {
      slug: 'acme',
      name: 'Acme',
      client: 'Acme Co',
      environment: 'production',
    }
    const echoed = withSiteEcho(
      new ResultWithImages({ id: 'x' }, [image]),
      echo,
    )
    expect(echoed).toBeInstanceOf(ResultWithImages)
    const result = toCallResult(echoed)
    expect(result.content[1]).toEqual({ type: 'image', ...image })
    expect(
      JSON.parse((result.content[0] as { text: string }).text),
    ).toMatchObject({ id: 'x', site: { slug: 'acme' } })
  })
})
