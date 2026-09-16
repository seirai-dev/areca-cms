import { m } from '#/paraglide/messages'

export class NotFoundError extends Error {
  readonly status = 404
  constructor(message = m.server_not_found()) {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class ConflictError extends Error {
  readonly status = 409
  constructor(message: string) {
    super(message)
    this.name = 'ConflictError'
  }
}

export class ValidationError extends Error {
  readonly status = 400
  readonly errors: { path: string; message: string }[]
  constructor(errors: { path: string; message: string }[]) {
    const text =
      errors
        .map((e) => (e.path ? `${e.path}: ${e.message}` : e.message))
        .join('; ') || m.server_validation_failed()
    super(text)
    this.name = 'ValidationError'
    this.errors = errors
  }
}
