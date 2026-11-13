import { redirect } from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'

import { MfaRequiredError } from '#/lib/security-errors'

import { guardErrorResponse } from './guard-response'

describe('guardErrorResponse', () => {
  it('answers a sign-in redirect with 401', () => {
    expect(guardErrorResponse(redirect({ href: '/login' }))?.status).toBe(401)
  })

  it('passes a thrown Response through', () => {
    const forbidden = new Response('Forbidden', { status: 403 })
    expect(guardErrorResponse(forbidden)).toBe(forbidden)
  })

  it('answers a security code with 403 and the code, with the given headers', async () => {
    const res = guardErrorResponse(new MfaRequiredError('needed'), {
      'Cache-Control': 'no-store',
    })
    expect(res?.status).toBe(403)
    expect(await res?.text()).toBe('MFA_REQUIRED')
    expect(res?.headers.get('Cache-Control')).toBe('no-store')
  })

  it('leaves other errors to the route', () => {
    expect(guardErrorResponse(new Error('boom'))).toBeNull()
  })
})
