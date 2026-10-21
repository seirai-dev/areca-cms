import { m } from '#/paraglide/messages'

import { renderLayout } from '../layout.ts'
import type { RenderContext, RenderedMail } from '../types.ts'

/** Sent by "Send test email" in Agency → Mail. Carries no secrets. */
export function render(
  params: Record<string, unknown>,
  ctx: RenderContext,
): RenderedMail {
  const { locale, brand } = ctx
  const host = String(params.host ?? '')
  const sentBy = String(params.sentBy ?? '')
  const subject = m.server_mail_tpl_test_subject(
    { app: brand.appName },
    { locale },
  )
  const preheader = m.server_mail_tpl_test_preheader({}, { locale })
  const { html, text } = renderLayout({
    brand,
    preheader,
    heading: subject,
    paragraphs: [m.server_mail_tpl_test_body({ host }, { locale })],
    footer: [m.server_mail_tpl_test_footer({ sentBy }, { locale })],
    lang: locale,
  })
  return { subject, preheader, html, text, secrets: [] }
}
