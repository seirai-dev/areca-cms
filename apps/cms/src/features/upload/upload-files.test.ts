import { describe, expect, it } from 'vitest'

import { fileKind, rejectReason, sortIncoming } from './upload-files'

const MB = 1024 * 1024
const file = (name: string, type: string, size = 1000) => ({ name, type, size })

describe('upload page file checks', () => {
  it('accepts the library types, also when the browser leaves the type empty', () => {
    expect(fileKind(file('a.jpg', 'image/jpeg'))).toBe('image')
    expect(fileKind(file('scan.pdf', 'application/pdf'))).toBe('pdf')
    expect(fileKind(file('b.WEBP', ''))).toBe('image')
    expect(fileKind(file('notes.txt', 'text/plain'))).toBeNull()
  })

  it('names the reason a file is refused', () => {
    expect(rejectReason(file('logo.svg', 'image/svg+xml'), 20 * MB)).toBe('svg')
    expect(rejectReason(file('IMG_1.HEIC', ''), 20 * MB)).toBe('heic')
    expect(rejectReason(file('p.heif', 'image/heif'), 20 * MB)).toBe('heic')
    expect(rejectReason(file('a.zip', 'application/zip'), 20 * MB)).toBe('type')
    expect(rejectReason(file('a.png', 'image/png', 0), 20 * MB)).toBe('empty')
    expect(rejectReason(file('a.png', 'image/png', 21 * MB), 20 * MB)).toBe(
      'size',
    )
    expect(rejectReason(file('a.png', 'image/png'), 20 * MB)).toBeNull()
  })

  it('refuses files beyond the room left on the link', () => {
    const { accepted, rejected } = sortIncoming(
      [
        file('1.png', 'image/png'),
        file('bad.svg', 'image/svg+xml'),
        file('2.png', 'image/png'),
        file('3.png', 'image/png'),
      ],
      2,
      20 * MB,
    )
    expect(accepted.map((entry) => entry.name)).toEqual(['1.png', '2.png'])
    expect(rejected).toEqual([
      { name: 'bad.svg', reason: 'svg' },
      { name: '3.png', reason: 'count' },
    ])
  })
})
