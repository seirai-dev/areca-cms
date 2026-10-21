import { env } from '#/env'
import type { BrandingView } from '#/lib/branding'

import type { MailTemplate } from '../outbox.ts'

import * as invitation from './templates/invitation.ts'
import * as test from './templates/test.ts'
import { MailRenderError } from './types.ts'
import type {
  Executor,
  MailBrand,
  MailLocale,
  RenderContext,
  RenderedMail,
} from './types.ts'

export { MailRenderError, mailLocale } from './types.ts'
export type { Executor, MailBrand, MailLocale, RenderedMail } from './types.ts'

type Renderer = (
  params: Record<string, unknown>,
  ctx: RenderContext,
) => RenderedMail | Promise<RenderedMail>

const RENDERERS: Record<MailTemplate, Renderer> = {
  invitation: invitation.render,
  test: test.render,
}

/** Branding for emails: the logo path becomes an absolute URL for clients. */
export function toMailBrand(brand: BrandingView): MailBrand {
  const base = env.APP_URL.replace(/\/$/, '')
  return {
    appName: brand.appName,
    accentColor: brand.accentColor,
    font: brand.font,
    emailFromName: brand.emailFromName,
    logoUrl: brand.logoUrl ? `${base}${brand.logoUrl}` : null,
  }
}

/** Renders a template in `locale` with the current branding. */
export async function renderTemplate(
  template: MailTemplate,
  params: Record<string, unknown>,
  options: { locale: MailLocale; brand: BrandingView; connection?: Executor },
): Promise<RenderedMail> {
  const renderer = RENDERERS[template] as Renderer | undefined
  if (!renderer) throw new MailRenderError(`unknown template ${template}`)
  return renderer(params, {
    locale: options.locale,
    brand: toMailBrand(options.brand),
    connection: options.connection,
  })
}
