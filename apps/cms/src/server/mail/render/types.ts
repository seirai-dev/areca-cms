import type { db } from '#/db'
import type { BrandingView } from '#/lib/branding'

/** The database or a transaction on it. */
export type Executor = typeof db

export const MAIL_LOCALES = ['en', 'nl', 'tr'] as const
export type MailLocale = (typeof MAIL_LOCALES)[number]

/** Known locale or English. Recipients without a stored language get English. */
export function mailLocale(value: string | null | undefined): MailLocale {
  return MAIL_LOCALES.find((locale) => locale === value) ?? 'en'
}

/** Branding as emails use it. `logoUrl` is absolute, since clients fetch it. */
export type MailBrand = Pick<
  BrandingView,
  'appName' | 'accentColor' | 'font' | 'emailFromName'
> & { logoUrl: string | null }

export type RenderContext = {
  locale: MailLocale
  brand: MailBrand
  /** Read through this when enqueueing inside a transaction. */
  connection?: Executor
}

export type RenderedMail = {
  subject: string
  preheader: string
  html: string
  text: string
  /** Values that must never reach logs or stored errors (tokens, links). */
  secrets: string[]
}

/** The template cannot be sent (for example its invitation was revoked). Never retried. */
export class MailRenderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MailRenderError'
  }
}
