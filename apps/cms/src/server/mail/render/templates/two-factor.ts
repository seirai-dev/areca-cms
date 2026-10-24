import { env } from '#/env'
import { m } from '#/paraglide/messages'

import { renderLayout } from '../layout.ts'
import type { RenderContext, RenderedMail } from '../types.ts'

import { formatUtc, loadRecipient } from './shared.ts'

type TwoFactorChange = 'enabled' | 'disabled'

/** Shared by "turned on" and "turned off": same layout, different copy. */
async function renderChange(
  change: TwoFactorChange,
  params: Record<string, unknown>,
  ctx: RenderContext,
): Promise<RenderedMail> {
  const { locale, brand } = ctx
  await loadRecipient(params.userId, ctx.connection)
  const date = formatUtc(params.at, locale)
  const enabled = change === 'enabled'
  const subject = enabled
    ? m.server_mail_tpl_two_factor_enabled_subject({}, { locale })
    : m.server_mail_tpl_two_factor_disabled_subject({}, { locale })
  const preheader = enabled
    ? m.server_mail_tpl_two_factor_enabled_preheader({}, { locale })
    : m.server_mail_tpl_two_factor_disabled_preheader({}, { locale })
  const body = enabled
    ? m.server_mail_tpl_two_factor_enabled_body({ date }, { locale })
    : m.server_mail_tpl_two_factor_disabled_body({ date }, { locale })
  const footer = enabled
    ? m.server_mail_tpl_two_factor_enabled_footer({}, { locale })
    : m.server_mail_tpl_two_factor_disabled_footer({}, { locale })
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

export function renderEnabled(
  params: Record<string, unknown>,
  ctx: RenderContext,
): Promise<RenderedMail> {
  return renderChange('enabled', params, ctx)
}

export function renderDisabled(
  params: Record<string, unknown>,
  ctx: RenderContext,
): Promise<RenderedMail> {
  return renderChange('disabled', params, ctx)
}

/**
 * Sent when an agency admin resets someone's two-factor sign-in. A security
 * notice, so it ignores preferences.
 */
export async function renderReset(
  params: Record<string, unknown>,
  ctx: RenderContext,
): Promise<RenderedMail> {
  const { locale, brand } = ctx
  await loadRecipient(params.userId, ctx.connection)
  const actor = String(params.actorName ?? '')
  const date = formatUtc(params.at, locale)
  const subject = m.server_mail_tpl_two_factor_reset_subject({}, { locale })
  const preheader = m.server_mail_tpl_two_factor_reset_preheader({}, { locale })
  const { html, text } = renderLayout({
    brand,
    preheader,
    heading: subject,
    paragraphs: [
      m.server_mail_tpl_two_factor_reset_body({ actor, date }, { locale }),
    ],
    button: {
      label: m.server_mail_tpl_review_account({}, { locale }),
      url: `${env.APP_URL.replace(/\/$/, '')}/account`,
    },
    footer: [m.server_mail_tpl_two_factor_reset_footer({}, { locale })],
    lang: locale,
  })
  return { subject, preheader, html, text, secrets: [] }
}
