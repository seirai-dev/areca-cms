/**
 * Test-only stand-in for the TanStack Start compiler transform.
 *
 * In production the Start Vite plugin rewrites `.handler(fn)` into
 * `.handler(extractedStub, fn)` so `__executeServer` can run the real
 * validator + middleware chain + handler. Vitest does not run that plugin, so
 * we replicate just that rewrite. Everything else (validators, global
 * `sanitizeErrorsMiddleware`, `requireUser`, ...) is the real code.
 *
 * Import-free on purpose (see authz-state.ts).
 */
type Builder = {
  (options?: unknown): Builder
  options: unknown
  handler: (...args: unknown[]) => unknown
  validator: (v: unknown) => Builder
  inputValidator: (v: unknown) => Builder
  middleware: (m: unknown) => Builder
}

export function patchStart<T extends { createServerFn: unknown }>(actual: T) {
  const original = actual.createServerFn as (options?: unknown) => Builder
  const stub = () => {
    const extracted = () => {
      throw new Error('client transport is not available in tests')
    }
    return extracted
  }
  const patch = (builder: Builder): Builder => {
    const out = ((options?: unknown) => patch(builder(options))) as Builder
    out.options = builder.options
    out.handler = (fn) => builder.handler(stub(), fn)
    out.validator = (v) => patch(builder.validator(v))
    out.inputValidator = (v) => patch(builder.inputValidator(v))
    out.middleware = (m) => patch(builder.middleware(m))
    return out
  }
  return {
    ...actual,
    createServerFn: (options?: unknown) => patch(original(options)),
  }
}
