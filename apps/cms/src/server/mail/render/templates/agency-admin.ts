import { env } from '#/env'
import { m } from '#/paraglide/messages'

import { renderLayout } from '../layout.ts'
import type { RenderContext, RenderedMail } from '../types.ts'

import { formatUtc, loadRecipient } from './shared.ts'

type AdminChange = 'granted' | 'revoked'

/**
 * Granted and revoked share one layout. Sent as a security notice, so it has no
 * notification preference. The actor's name is captured when the change is made.
 */
async function renderChange(
  change: AdminChange,
  params: Record<string, unknown>,
  ctx: RenderContext,
): Promise<RenderedMail> {
  const { locale, brand } = ctx
  await loadRecipient(params.userId, ctx.connection)
  const actor = String(params.actorName ?? '')
  const date = formatUtc(params.at, locale)
  const granted = change === 'granted'
  const subject = granted
    ? m.server_mail_tpl_agency_admin_granted_subject({}, { locale })
    : m.server_mail_tpl_agency_admin_revoked_subject({}, { locale })
  const preheader = granted
    ? m.server_mail_tpl_agency_admin_granted_preheader({}, { locale })
    : m.server_mail_tpl_agency_admin_revoked_preheader({}, { locale })
  const body = granted
    ? m.server_mail_tpl_agency_admin_granted_body({ actor, date }, { locale })
    : m.server_mail_tpl_agency_admin_revoked_body({ actor, date }, { locale })
  const footer = granted
    ? m.server_mail_tpl_agency_admin_granted_footer({}, { locale })
    : m.server_mail_tpl_agency_admin_revoked_footer({}, { locale })
  const { html, text } = renderLayout({
    brand,
    preheader,
    heading: subject,
    paragraphs: [body],
    button: {
      label: m.server_mail_tpl_review_account({}, { locale }),
      url: `${env.APP_URL.replace(/\/$/, '')}/account`,
    },
    footer: [footer],
    lang: locale,
  })
  return { subject, preheader, html, text, secrets: [] }
}

/** Sent to someone an agency admin makes an agency admin. */
export function renderGranted(
  params: Record<string, unknown>,
  ctx: RenderContext,
): Promise<RenderedMail> {
  return renderChange('granted', params, ctx)
}

/** Sent to someone whose agency admin access an agency admin removes. */
export function renderRevoked(
  params: Record<string, unknown>,
  ctx: RenderContext,
): Promise<RenderedMail> {
  return renderChange('revoked', params, ctx)
}
