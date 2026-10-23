import { describe, expect, it } from 'vitest'

import { parseUserAgent } from './user-agent'

describe('parseUserAgent', () => {
  it('names a desktop Chrome on macOS', () => {
    expect(
      parseUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
      ),
    ).toEqual({ browser: 'Chrome', os: 'macOS', device: 'desktop' })
  })

  it('tells Edge and Opera apart from Chrome', () => {
    expect(
      parseUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0',
      ).browser,
    ).toBe('Edge')
    expect(
      parseUserAgent(
        'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/129.0 Safari/537.36 OPR/114.0',
      ).browser,
    ).toBe('Opera')
  })

  it('names Safari on an iPhone as a mobile iOS device', () => {
    expect(
      parseUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      ),
    ).toEqual({ browser: 'Safari', os: 'iOS', device: 'mobile' })
  })

  it('treats an iPad as a tablet, not a Mac', () => {
    expect(
      parseUserAgent(
        'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      ),
    ).toEqual({ browser: 'Safari', os: 'iOS', device: 'tablet' })
  })

  it('separates Android phones and tablets', () => {
    expect(
      parseUserAgent(
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36',
      ),
    ).toEqual({ browser: 'Chrome', os: 'Android', device: 'mobile' })
    expect(
      parseUserAgent(
        'Mozilla/5.0 (Linux; Android 14; SM-X700) AppleWebKit/537.36 Chrome/129.0 Safari/537.36',
      ).device,
    ).toBe('tablet')
  })

  it('says nothing it cannot tell', () => {
    expect(parseUserAgent(null)).toEqual({
      browser: null,
      os: null,
      device: 'unknown',
    })
    expect(parseUserAgent('curl/8.4.0')).toEqual({
      browser: null,
      os: null,
      device: 'desktop',
    })
  })
})
