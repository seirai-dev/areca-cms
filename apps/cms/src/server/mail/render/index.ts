import { env } from '#/env'
import type { BrandingView } from '#/lib/branding'

import type { MailTemplate } from '../outbox.ts'

import * as invitation from './templates/invitation.ts'
import * as membership from './templates/membership.ts'
import * as notification from './templates/notification.ts'
import * as passwordChanged from './templates/password-changed.ts'
import * as passwordReset from './templates/password-reset.ts'
import * as passwordResetSso from './templates/password-reset-sso.ts'
import * as test from './templates/test.ts'
import * as twoFactor from './templates/two-factor.ts'
import * as verifyEmail from './templates/verify-email.ts'
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
  notification: notification.render,
  test: test.render,
  password_reset: passwordReset.render,
  password_reset_sso: passwordResetSso.render,
  verify_email: verifyEmail.render,
  password_changed: passwordChanged.render,
  two_factor_enabled: twoFactor.renderEnabled,
  two_factor_disabled: twoFactor.renderDisabled,
  membership_removed: membership.renderRemoved,
  membership_role_changed: membership.renderRoleChanged,
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
