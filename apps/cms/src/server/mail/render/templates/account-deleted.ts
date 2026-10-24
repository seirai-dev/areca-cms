import { m } from '#/paraglide/messages'

import { renderLayout } from '../layout.ts'
import type { RenderContext, RenderedMail } from '../types.ts'

import { formatUtc } from './shared.ts'

/**
 * Sent when an account is deleted, by its owner or by an agency admin. The
 * account is gone by the time this renders, so nothing is read from it: the
 * name, the actor and the time were captured when the account was deleted.
 * The address and language come from the outbox row.
 */
export function renderDeleted(
  params: Record<string, unknown>,
  ctx: RenderContext,
): RenderedMail {
  const { locale, brand } = ctx
  const self = params.self === true
  const actor = String(params.actorName ?? '')
  const date = formatUtc(params.at, locale)
  const subject = self
    ? m.server_mail_tpl_account_deleted_subject_self({}, { locale })
    : m.server_mail_tpl_account_deleted_subject_admin({}, { locale })
  const preheader = m.server_mail_tpl_account_deleted_preheader({}, { locale })
  const body = self
    ? m.server_mail_tpl_account_deleted_body_self({ date }, { locale })
    : m.server_mail_tpl_account_deleted_body_admin({ actor, date }, { locale })
  const { html, text } = renderLayout({
    brand,
    preheader,
    heading: subject,
    paragraphs: [body],
    footer: [m.server_mail_tpl_account_deleted_footer({}, { locale })],
    lang: locale,
  })
  return { subject, preheader, html, text, secrets: [] }
}
