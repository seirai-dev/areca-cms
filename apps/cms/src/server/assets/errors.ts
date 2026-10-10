import { AppError } from '#/server/http/app-error'

export class AssetValidationError extends AppError {
  constructor(message: string) {
    super(message)
    this.name = 'AssetValidationError'
  }
}
