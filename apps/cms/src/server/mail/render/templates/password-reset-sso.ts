import { env } from '#/env'
import { m } from '#/paraglide/messages'

import { renderLayout } from '../layout.ts'
import { MailRenderError } from '../types.ts'
import type { RenderContext, RenderedMail } from '../types.ts'

import { listOr, loadRecipient } from './shared.ts'

/** Sent instead of a reset link to accounts that have no password. */
export async function render(
  params: Record<string, unknown>,
  ctx: RenderContext,
): Promise<RenderedMail> {
  const { locale, brand } = ctx
  await loadRecipient(params.userId, ctx.connection)
  const providers = Array.isArray(params.providers)
    ? params.providers.filter(
        (item): item is string => typeof item === 'string',
      )
    : []
  if (providers.length === 0) {
    throw new MailRenderError('the account has no other sign-in method')
  }
  const names = listOr(providers, locale)
  const subject = m.server_mail_tpl_password_reset_sso_subject(
    { providers: names },
    { locale },
  )
  const preheader = m.server_mail_tpl_password_reset_sso_preheader(
    { providers: names },
    { locale },
  )
  const { html, text } = renderLayout({
    brand,
    preheader,
    heading: subject,
    paragraphs: [
      m.server_mail_tpl_password_reset_sso_body(
        { providers: names },
        { locale },
      ),
    ],
    button: {
      label: m.server_mail_tpl_password_reset_sso_button({}, { locale }),
      url: `${env.APP_URL.replace(/\/$/, '')}/login`,
    },
    footer: [m.server_mail_tpl_password_reset_sso_footer({}, { locale })],
    lang: locale,
  })
  return { subject, preheader, html, text, secrets: [] }
}
