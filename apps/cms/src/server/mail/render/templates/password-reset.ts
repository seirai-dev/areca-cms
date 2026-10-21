import { env } from '#/env'
import { m } from '#/paraglide/messages'
import { secretsEncryptionKey } from '#/server/security/secrets-key'
import { decryptSecret } from '#/server/security/secret-encryption'

import { renderLayout } from '../layout.ts'
import { MailRenderError } from '../types.ts'
import type { RenderContext, RenderedMail } from '../types.ts'

import { loadRecipient } from './shared.ts'

/** Context the encrypted reset token is bound to in the outbox. */
export const PARAMS_SECRET_CONTEXT = 'email-outbox:params'

/**
 * The reset link. The stored row keeps the token encrypted when a key exists;
 * otherwise only the immediate send (which passes `token`) can build the link.
 */
function resolveToken(params: Record<string, unknown>): string {
  if (typeof params.encryptedToken === 'string') {
    const key = secretsEncryptionKey()
    if (!key) throw new MailRenderError('the reset token key is not set')
    try {
      return decryptSecret(params.encryptedToken, key, PARAMS_SECRET_CONTEXT)
    } catch {
      throw new MailRenderError('the reset token could not be read')
    }
  }
  if (typeof params.token === 'string' && params.token) return params.token
  throw new MailRenderError('the reset link is no longer available')
}

export async function render(
  params: Record<string, unknown>,
  ctx: RenderContext,
): Promise<RenderedMail> {
  const { locale, brand } = ctx
  await loadRecipient(params.userId, ctx.connection)
  const token = resolveToken(params)
  const link = `${env.APP_URL.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`
  const subject = m.server_mail_tpl_password_reset_subject({}, { locale })
  const preheader = m.server_mail_tpl_password_reset_preheader({}, { locale })
  const { html, text } = renderLayout({
    brand,
    preheader,
    heading: subject,
    paragraphs: [m.server_mail_tpl_password_reset_body({}, { locale })],
    button: {
      label: m.server_mail_tpl_password_reset_button({}, { locale }),
      url: link,
    },
    footer: [m.server_mail_tpl_password_reset_footer({}, { locale })],
    lang: locale,
  })
  return { subject, preheader, html, text, secrets: [token, link] }
}
