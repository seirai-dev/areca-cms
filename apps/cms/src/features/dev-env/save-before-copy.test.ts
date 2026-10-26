import { describe, expect, it, vi } from 'vitest'

import { saveBeforeCopy } from './save-before-copy'

describe('saveBeforeCopy', () => {
  it('resolves when the editor save landed', async () => {
    await expect(saveBeforeCopy(async () => 'saved')).resolves.toBeUndefined()
  })

  it.each(['failed', 'blocked'] as const)(
    'throws without saving more when the save is %s',
    async (outcome) => {
      const save = vi.fn(async () => outcome)
      await expect(saveBeforeCopy(save)).rejects.toThrow()
      expect(save).toHaveBeenCalledTimes(1)
    },
  )
})
