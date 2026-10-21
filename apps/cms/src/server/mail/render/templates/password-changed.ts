import { env } from '#/env'
import { m } from '#/paraglide/messages'

import { renderLayout } from '../layout.ts'
import type { RenderContext, RenderedMail } from '../types.ts'

import { formatUtc, loadRecipient } from './shared.ts'

/** Sent after any password change. The button starts a reset for a stranger's change. */
export async function render(
  params: Record<string, unknown>,
  ctx: RenderContext,
): Promise<RenderedMail> {
  const { locale, brand } = ctx
  await loadRecipient(params.userId, ctx.connection)
  const date = formatUtc(params.at, locale)
  const subject = m.server_mail_tpl_password_changed_subject({}, { locale })
  const preheader = m.server_mail_tpl_password_changed_preheader({}, { locale })
  const { html, text } = renderLayout({
    brand,
    preheader,
    heading: subject,
    paragraphs: [m.server_mail_tpl_password_changed_body({ date }, { locale })],
    button: {
      label: m.server_mail_tpl_password_changed_button({}, { locale }),
      url: `${env.APP_URL.replace(/\/$/, '')}/forgot-password`,
    },
    footer: [m.server_mail_tpl_password_changed_footer({}, { locale })],
    lang: locale,
  })
  return { subject, preheader, html, text, secrets: [] }
}
