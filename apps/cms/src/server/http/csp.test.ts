import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  SONNER_STYLE_HASH,
  contentSecurityPolicyHeader,
  developmentCsp,
  productionCsp,
} from './csp'
import { createCspNonce, currentCspNonce, withCspNonce } from './csp-nonce'

/** The directive named `name` in a policy string, e.g. "script-src 'self'". */
function directive(policy: string, name: string) {
  return policy
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `))
}

describe('productionCsp', () => {
  const policy = productionCsp('nonce-value')

  it('admits scripts and head styles only with the request nonce', () => {
    expect(directive(policy, 'script-src')).toBe(
      "script-src 'self' 'nonce-nonce-value'",
    )
    expect(directive(policy, 'style-src')).toContain("'nonce-nonce-value'")
    expect(directive(policy, 'style-src')).not.toContain('unsafe-inline')
    expect(directive(policy, 'style-src')).toContain(SONNER_STYLE_HASH)
    expect(directive(policy, 'script-src')).not.toContain('unsafe-')
  })

  it('allows inline style attributes, which React renders for layout', () => {
    expect(directive(policy, 'style-src-attr')).toBe(
      "style-src-attr 'unsafe-inline'",
    )
  })

  it('allows only the Google Fonts origins the branding preview loads', () => {
    expect(directive(policy, 'style-src')).toContain(
      'https://fonts.googleapis.com',
    )
    expect(directive(policy, 'font-src')).toBe(
      "font-src 'self' data: https://fonts.gstatic.com",
    )
    expect(directive(policy, 'connect-src')).toBe("connect-src 'self'")
  })

  it('locks down plugins, base URIs, forms and framing', () => {
    expect(directive(policy, 'default-src')).toBe("default-src 'self'")
    expect(directive(policy, 'object-src')).toBe("object-src 'none'")
    expect(directive(policy, 'base-uri')).toBe("base-uri 'self'")
    expect(directive(policy, 'form-action')).toBe("form-action 'self'")
    expect(directive(policy, 'frame-ancestors')).toBe("frame-ancestors 'none'")
  })

  it('lets the editor frame https previews and local http previews only', () => {
    expect(directive(policy, 'frame-src')).toBe(
      "frame-src 'self' https: http://localhost:* http://127.0.0.1:*",
    )
  })

  it('uses a different script nonce for each request', () => {
    expect(productionCsp(createCspNonce())).not.toBe(
      productionCsp(createCspNonce()),
    )
  })
})

describe('Sonner stylesheet hash', () => {
  it('matches the stylesheet the installed Sonner injects', () => {
    // Sonner injects one literal stylesheet when its module loads. The hash
    // must be of that exact text, so an upgrade that changes it fails here.
    const dist = dirname(createRequire(import.meta.url).resolve('sonner'))
    const source = readFileSync(join(dist, 'index.mjs'), 'utf8')
    const literal = /__insertCSS\("((?:[^"\\]|\\.)*)"\)/.exec(source)?.[1]
    expect(literal, 'Sonner stylesheet not found in its bundle').toBeDefined()
    const css = JSON.parse(`"${literal}"`) as string
    const hash = createHash('sha256').update(css).digest('base64')
    expect(
      SONNER_STYLE_HASH,
      'Sonner changed its stylesheet: update SONNER_STYLE_HASH in csp.ts',
    ).toBe(`'sha256-${hash}'`)
  })
})

describe('developmentCsp', () => {
  const policy = developmentCsp()

  it('relaxes scripts and styles for the Vite dev server and HMR', () => {
    expect(directive(policy, 'script-src')).toContain("'unsafe-inline'")
    expect(directive(policy, 'script-src')).toContain("'unsafe-eval'")
    expect(directive(policy, 'connect-src')).toContain('ws:')
  })

  it('keeps the framing and object restrictions', () => {
    expect(directive(policy, 'object-src')).toBe("object-src 'none'")
    expect(directive(policy, 'frame-ancestors')).toBe("frame-ancestors 'none'")
  })

  it('allows http previews in development', () => {
    expect(directive(policy, 'frame-src')).toBe("frame-src 'self' http: https:")
  })
})

describe('contentSecurityPolicyHeader', () => {
  it('enforces the production policy by default', () => {
    const [name, value] = contentSecurityPolicyHeader({
      nonce: 'n1',
      reportOnly: false,
      development: false,
    })
    expect(name).toBe('Content-Security-Policy')
    expect(value).toBe(productionCsp('n1'))
  })

  it('reports the production policy only when reportOnly is set', () => {
    const [name, value] = contentSecurityPolicyHeader({
      nonce: 'n1',
      reportOnly: true,
      development: false,
    })
    expect(name).toBe('Content-Security-Policy-Report-Only')
    expect(value).toBe(productionCsp('n1'))
  })

  it('uses the relaxed policy under the dev server, whatever reportOnly says', () => {
    expect(
      contentSecurityPolicyHeader({
        nonce: 'n1',
        reportOnly: true,
        development: true,
      }),
    ).toEqual(['Content-Security-Policy', developmentCsp()])
  })
})

describe('per-request nonce', () => {
  it('is available only while a request is being handled', async () => {
    expect(currentCspNonce()).toBeUndefined()
    const inside = await withCspNonce('req-1', async () => {
      await Promise.resolve()
      return currentCspNonce()
    })
    expect(inside).toBe('req-1')
    expect(currentCspNonce()).toBeUndefined()
  })

  it('keeps concurrent requests apart', async () => {
    const seen = await Promise.all(
      ['a', 'b', 'c'].map((nonce) =>
        withCspNonce(nonce, async () => {
          await new Promise((resolve) => setTimeout(resolve, 5))
          return currentCspNonce()
        }),
      ),
    )
    expect(seen).toEqual(['a', 'b', 'c'])
  })

  it('creates base64url nonces of 128 bits', () => {
    const nonce = createCspNonce()
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{22}$/)
  })
})
