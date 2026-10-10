import { describe, expect, it, vi } from 'vitest'

import { ConflictError, ForbiddenError, ValidationError } from '#/server/content/errors'
import { AssetInUseError } from '#/server/assets'
import { RemoteFetchError } from '#/server/assets/remote'

import { McpNotFoundError, toToolError } from './errors'

function text(result: ReturnType<typeof toToolError>): string {
  const first = result.content.at(0)
  return first?.type === 'text' ? first.text : ''
}

describe('toToolError', () => {
  it('names the invalid fields and asks for a retry', () => {
    const result = toToolError(
      new ValidationError([{ path: 'fields.slug', message: 'must be lowercase letters, numbers and dashes' }]),
    )
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('fields.slug: must be lowercase letters, numbers and dashes')
    expect(text(result)).toContain('get_collection_schema')
  })

  it('explains a draft conflict in plain words', () => {
    expect(text(toToolError(new ConflictError('DRAFT_CONFLICT: changed')))).toContain('get_entry')
  })

  it('explains how many items use an asset', () => {
    expect(text(toToolError(new AssetInUseError(3)))).toContain('used by 3 item(s)')
  })

  it('passes through forbidden and not-found messages', () => {
    expect(text(toToolError(new ForbiddenError('Only site owners can do that.')))).toBe(
      'Only site owners can do that.',
    )
    expect(text(toToolError(new McpNotFoundError('No entry with id "x" on this site.')))).toBe(
      'No entry with id "x" on this site.',
    )
  })

  it('prefixes remote download failures', () => {
    expect(text(toToolError(new RemoteFetchError('The download timed out')))).toBe(
      'Could not import the file: The download timed out',
    )
  })

  it('hides unknown errors behind a reference and logs them', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = toToolError(new Error('SELECT * FROM secret_table'))
    expect(text(result)).toContain('ref ')
    expect(text(result)).not.toContain('secret_table')
    spy.mockRestore()
  })
})
