import { env } from '#/env'
import { m } from '#/paraglide/messages'
import { emailChangeLink } from '#/server/security/email-change'

import { renderLayout } from '../layout.ts'
import { MailRenderError } from '../types.ts'
import type { RenderContext, RenderedMail } from '../types.ts'

import { formatUtc, loadRecipient } from './shared.ts'

/**
 * Sent to the new address. The link is derived from the pending change when
 * the mail renders (a retry gets a working link), never stored.
 */
export async function renderVerify(
  params: Record<string, unknown>,
  ctx: RenderContext,
): Promise<RenderedMail> {
  const { locale, brand } = ctx
  const recipient = await loadRecipient(params.userId, ctx.connection)
  if (typeof params.newEmail !== 'string' || !params.newEmail) {
    throw new MailRenderError('the new email address is missing')
  }
  const link = await emailChangeLink(recipient.id, params.newEmail)
  if (!link) {
    throw new MailRenderError('the email change is no longer pending')
  }
  const subject = m.server_mail_tpl_email_change_verify_subject({}, { locale })
  const preheader = m.server_mail_tpl_email_change_verify_preheader(
    {},
    { locale },
  )
  const { html, text } = renderLayout({
    brand,
    preheader,
    heading: subject,
    paragraphs: [m.server_mail_tpl_email_change_verify_body({}, { locale })],
    button: {
      label: m.server_mail_tpl_email_change_verify_button({}, { locale }),
      url: link.url,
    },
    footer: [m.server_mail_tpl_email_change_verify_footer({}, { locale })],
    lang: locale,
  })
  return { subject, preheader, html, text, secrets: [link.token, link.url] }
}

/**
 * Sent to the current address when a change is requested. The button starts
 * a password reset, which also cancels the pending change.
 */
export async function renderNotice(
  params: Record<string, unknown>,
  ctx: RenderContext,
): Promise<RenderedMail> {
  const { locale, brand } = ctx
  await loadRecipient(params.userId, ctx.connection)
  const email = String(params.newEmail ?? '')
  const date = formatUtc(params.at, locale)
  const subject = m.server_mail_tpl_email_change_notice_subject({}, { locale })
  const preheader = m.server_mail_tpl_email_change_notice_preheader(
    {},
    { locale },
  )
  const { html, text } = renderLayout({
    brand,
    preheader,
    heading: subject,
    paragraphs: [
      m.server_mail_tpl_email_change_notice_body({ email, date }, { locale }),
    ],
    button: {
      label: m.server_mail_tpl_email_change_notice_button({}, { locale }),
      url: `${env.APP_URL.replace(/\/$/, '')}/forgot-password`,
    },
    footer: [m.server_mail_tpl_email_change_notice_footer({}, { locale })],
    lang: locale,
  })
  return { subject, preheader, html, text, secrets: [] }
}

/** Sent to the old address once the change is confirmed. */
export async function renderChanged(
  params: Record<string, unknown>,
  ctx: RenderContext,
): Promise<RenderedMail> {
  const { locale, brand } = ctx
  await loadRecipient(params.userId, ctx.connection)
  const email = String(params.newEmail ?? '')
  const date = formatUtc(params.at, locale)
  const subject = m.server_mail_tpl_email_changed_subject({}, { locale })
  const preheader = m.server_mail_tpl_email_changed_preheader({}, { locale })
  const { html, text } = renderLayout({
    brand,
    preheader,
    heading: subject,
    paragraphs: [
      m.server_mail_tpl_email_changed_body({ email, date }, { locale }),
    ],
    footer: [m.server_mail_tpl_email_changed_footer({}, { locale })],
    lang: locale,
  })
  return { subject, preheader, html, text, secrets: [] }
}
