import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes } from 'node:crypto'

const nonces = new AsyncLocalStorage<string>()

/** A fresh nonce: 128 random bits. base64url is valid in a CSP nonce source. */
export function createCspNonce(): string {
  return randomBytes(16).toString('base64url')
}

/** Runs `run` with `nonce` as the nonce of every request it handles. */
export function withCspNonce<T>(nonce: string, run: () => T): T {
  return nonces.run(nonce, run)
}

/** The nonce of the request being handled, or undefined outside a request. */
export function currentCspNonce(): string | undefined {
  return nonces.getStore()
}
