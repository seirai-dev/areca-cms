export class NotFoundError extends Error {
  readonly status = 404
  constructor(message = 'Not found') {
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
        .join('; ') || 'Validation failed'
    super(text)
    this.name = 'ValidationError'
    this.errors = errors
  }
}
