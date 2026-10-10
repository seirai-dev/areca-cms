import { describe, expect, it } from 'vitest'
import { isPickerImage } from './media-upload'

describe('image-only uploads (including dropped files)', () => {
  it('allows supported image types and rejects PDF, SVG and unknown types', () => {
    for (const type of [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'IMAGE/PNG',
    ])
      expect(isPickerImage(type)).toBe(true)
    for (const type of [
      'application/pdf',
      'image/svg+xml',
      'application/octet-stream',
      '',
    ])
      expect(isPickerImage(type)).toBe(false)
  })
})
