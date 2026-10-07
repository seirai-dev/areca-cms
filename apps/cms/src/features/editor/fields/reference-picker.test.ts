import { describe, expect, it } from 'vitest'

import { referencePickerUiStatus } from './reference-picker-status.ts'

describe('referencePickerUiStatus', () => {
  it('maps published to ready and scheduled to scheduled', () => {
    expect(referencePickerUiStatus('published')).toBe('ready')
    expect(referencePickerUiStatus('scheduled')).toBe('scheduled')
  })

  it('omits draft and archived', () => {
    expect(referencePickerUiStatus('draft')).toBeNull()
    expect(referencePickerUiStatus('archived')).toBeNull()
  })
})
