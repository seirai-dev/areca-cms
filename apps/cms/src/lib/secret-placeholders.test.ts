import { describe, expect, it } from 'vitest'

import {
  isAllZeroKey,
  isPlaceholderSecret,
  productionSecretProblems,
} from './secret-placeholders'

const ZERO_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
const REAL_KEY = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE='

describe('isPlaceholderSecret', () => {
  it('flags the example auth secrets', () => {
    expect(isPlaceholderSecret('replace-with-openssl-rand-hex-32')).toBe(true)
    expect(isPlaceholderSecret('change-me')).toBe(true)
  })

  it('accepts generated secrets', () => {
    expect(isPlaceholderSecret('9f1c2a7e0b4d4e8f9a6c3b2d1e0f9a8b')).toBe(false)
  })
})

describe('isAllZeroKey', () => {
  it('flags a key of zero bytes', () => {
    expect(isAllZeroKey(ZERO_KEY)).toBe(true)
  })

  it('accepts a key with any non-zero byte', () => {
    expect(isAllZeroKey(REAL_KEY)).toBe(false)
  })
})

describe('productionSecretProblems', () => {
  it('reports nothing for real secrets', () => {
    expect(
      productionSecretProblems({
        BETTER_AUTH_SECRET: '9f1c2a7e0b4d4e8f9a6c3b2d1e0f9a8b',
        DOKPLOY_CREDENTIALS_ENCRYPTION_KEY: REAL_KEY,
        AI_SETTINGS_ENCRYPTION_KEY: undefined,
      }),
    ).toEqual([])
  })

  it('names the auth secret placeholder and how to generate one', () => {
    const problems = productionSecretProblems({
      BETTER_AUTH_SECRET: 'replace-with-openssl-rand-hex-32',
    })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/BETTER_AUTH_SECRET is still a placeholder/)
    expect(problems[0]).toMatch(/openssl rand/)
  })

  it('names every all-zero encryption key that is set', () => {
    const problems = productionSecretProblems({
      DOKPLOY_CREDENTIALS_ENCRYPTION_KEY: ZERO_KEY,
      SECRETS_ENCRYPTION_KEY: ZERO_KEY,
    })
    expect(problems).toHaveLength(2)
    expect(problems.join('\n')).toMatch(/DOKPLOY_CREDENTIALS_ENCRYPTION_KEY/)
    expect(problems.join('\n')).toMatch(/SECRETS_ENCRYPTION_KEY/)
  })
})
