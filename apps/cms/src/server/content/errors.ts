import { m } from '#/paraglide/messages'
import { AppError } from '#/server/http/app-error'

export class NotFoundError extends AppError {
  readonly status = 404
  constructor(message = m.server_not_found()) {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class ForbiddenError extends AppError {
  readonly status = 403
  constructor(message: string) {
    super(message)
    this.name = 'ForbiddenError'
  }
}

export class ConflictError extends AppError {
  readonly status = 409
  constructor(message: string) {
    super(message)
    this.name = 'ConflictError'
  }
}

export class ValidationError extends AppError {
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
