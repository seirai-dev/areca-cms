import { createEmailVerificationToken } from 'better-auth/api'

import { env } from '#/env'
import { m } from '#/paraglide/messages'

import { renderLayout } from '../layout.ts'
import { MailRenderError } from '../types.ts'
import type { RenderContext, RenderedMail } from '../types.ts'

import { loadRecipient } from './shared.ts'

/** Better Auth's verify-email token lifetime, in seconds. */
const VERIFY_TTL_SECONDS = 24 * 60 * 60

export async function render(
  params: Record<string, unknown>,
  ctx: RenderContext,
): Promise<RenderedMail> {
  const { locale, brand } = ctx
  const recipient = await loadRecipient(params.userId, ctx.connection)
  if (recipient.emailVerified) {
    throw new MailRenderError('the email address is already verified')
  }
  // Derived now, not stored: the link is valid for a day from this send.
  const token = await createEmailVerificationToken(
    env.BETTER_AUTH_SECRET,
    recipient.email,
    undefined,
    VERIFY_TTL_SECONDS,
  )
  const base = env.BETTER_AUTH_URL.replace(/\/$/, '')
  const link = `${base}/api/auth/verify-email?token=${encodeURIComponent(token)}&callbackURL=${encodeURIComponent('/?verified=1')}`
  const subject = m.server_mail_tpl_verify_email_subject({}, { locale })
  const preheader = m.server_mail_tpl_verify_email_preheader({}, { locale })
  const { html, text } = renderLayout({
    brand,
    preheader,
    heading: subject,
    paragraphs: [m.server_mail_tpl_verify_email_body({}, { locale })],
    button: {
      label: m.server_mail_tpl_verify_email_button({}, { locale }),
      url: link,
    },
    footer: [m.server_mail_tpl_verify_email_footer({}, { locale })],
    lang: locale,
  })
  return { subject, preheader, html, text, secrets: [token, link] }
}
