import { eq } from 'drizzle-orm'

import { db } from '#/db'
import { notification } from '#/db/schema'
import { env } from '#/env'
import { isEventKey } from '#/lib/notifications'
import type { EventKey, NotificationPayload } from '#/lib/notifications'
import { m } from '#/paraglide/messages'
import { signUnsubscribeToken } from '#/server/notifications/unsubscribe'

import { renderLayout } from '../layout.ts'
import { MailRenderError } from '../types.ts'
import type { MailLocale, RenderContext, RenderedMail } from '../types.ts'

import { loadRecipient, roleLabel } from './shared.ts'

type Copy = {
  subject: string
  preheader: string
  body: string
  button: string
}

type Values = {
  site: string
  org: string
  name: string
  email: string
  role: string
}

/**
 * Copy per event. Every value is a `server_mail_tpl_notify_*` message, so the
 * compiler checks each placeholder. Failure copy never includes the job error.
 */
const COPY: Record<EventKey, (v: Values, locale: MailLocale) => Copy> = {
  'release.live': ({ site }, locale) => ({
    subject: m.server_mail_tpl_notify_release_live_subject(
      { site },
      { locale },
    ),
    preheader: m.server_mail_tpl_notify_release_live_preheader(
      { site },
      { locale },
    ),
    body: m.server_mail_tpl_notify_release_live_body({ site }, { locale }),
    button: m.server_mail_tpl_notify_release_live_button({}, { locale }),
  }),
  'release.live.others': ({ site }, locale) => ({
    subject: m.server_mail_tpl_notify_release_live_others_subject(
      { site },
      { locale },
    ),
    preheader: m.server_mail_tpl_notify_release_live_others_preheader(
      { site },
      { locale },
    ),
    body: m.server_mail_tpl_notify_release_live_others_body(
      { site },
      { locale },
    ),
    button: m.server_mail_tpl_notify_release_live_others_button({}, { locale }),
  }),
  'release.failed': ({ site }, locale) => ({
    subject: m.server_mail_tpl_notify_release_failed_subject(
      { site },
      { locale },
    ),
    preheader: m.server_mail_tpl_notify_release_failed_preheader(
      { site },
      { locale },
    ),
    body: m.server_mail_tpl_notify_release_failed_body({ site }, { locale }),
    button: m.server_mail_tpl_notify_release_failed_button({}, { locale }),
  }),
  'release.stuck': ({ site }, locale) => ({
    subject: m.server_mail_tpl_notify_release_stuck_subject(
      { site },
      { locale },
    ),
    preheader: m.server_mail_tpl_notify_release_stuck_preheader(
      { site },
      { locale },
    ),
    body: m.server_mail_tpl_notify_release_stuck_body({ site }, { locale }),
    button: m.server_mail_tpl_notify_release_stuck_button({}, { locale }),
  }),
  'schedule.published': ({ site }, locale) => ({
    subject: m.server_mail_tpl_notify_schedule_published_subject(
      { site },
      { locale },
    ),
    preheader: m.server_mail_tpl_notify_schedule_published_preheader(
      {},
      { locale },
    ),
    body: m.server_mail_tpl_notify_schedule_published_body(
      { site },
      { locale },
    ),
    button: m.server_mail_tpl_notify_schedule_published_button({}, { locale }),
  }),
  'schedule.failed': ({ site }, locale) => ({
    subject: m.server_mail_tpl_notify_schedule_failed_subject(
      { site },
      { locale },
    ),
    preheader: m.server_mail_tpl_notify_schedule_failed_preheader(
      { site },
      { locale },
    ),
    body: m.server_mail_tpl_notify_schedule_failed_body({ site }, { locale }),
    button: m.server_mail_tpl_notify_schedule_failed_button({}, { locale }),
  }),
  'rollback.live': ({ site }, locale) => ({
    subject: m.server_mail_tpl_notify_rollback_live_subject(
      { site },
      { locale },
    ),
    preheader: m.server_mail_tpl_notify_rollback_live_preheader(
      { site },
      { locale },
    ),
    body: m.server_mail_tpl_notify_rollback_live_body({ site }, { locale }),
    button: m.server_mail_tpl_notify_rollback_live_button({}, { locale }),
  }),
  'invite.accepted': ({ name, email, org, role }, locale) => ({
    subject: m.server_mail_tpl_notify_invite_accepted_subject(
      { name, org },
      { locale },
    ),
    preheader: m.server_mail_tpl_notify_invite_accepted_preheader(
      { name },
      { locale },
    ),
    body: m.server_mail_tpl_notify_invite_accepted_body(
      { name, email, org, role },
      { locale },
    ),
    button: m.server_mail_tpl_notify_invite_accepted_button({}, { locale }),
  }),
  'agency.release.failed': ({ site, org }, locale) => ({
    subject: m.server_mail_tpl_notify_agency_release_failed_subject(
      { org },
      { locale },
    ),
    preheader: m.server_mail_tpl_notify_agency_release_failed_preheader(
      { site, org },
      { locale },
    ),
    body: m.server_mail_tpl_notify_agency_release_failed_body(
      { site, org },
      { locale },
    ),
    button: m.server_mail_tpl_notify_agency_release_failed_button(
      {},
      { locale },
    ),
  }),
}

/**
 * The notification email. Params carry only ids: the row holds the payload,
 * the recipient role, and who locked the event when it was sent.
 */
export async function render(
  params: Record<string, unknown>,
  ctx: RenderContext,
): Promise<RenderedMail> {
  const { locale, brand } = ctx
  const row = (
    await (ctx.connection ?? db)
      .select()
      .from(notification)
      .where(eq(notification.id, String(params.notificationId ?? '')))
      .limit(1)
  ).at(0)
  if (!row) throw new MailRenderError('the notification no longer exists')
  await loadRecipient(row.userId, ctx.connection)
  if (!isEventKey(row.event)) {
    throw new MailRenderError(`unknown notification event ${row.event}`)
  }
  const event = row.event
  const payload: NotificationPayload = row.payload
  const base = env.APP_URL.replace(/\/$/, '')
  const copy = COPY[event](
    {
      site: payload.siteName ?? '',
      org: payload.orgName ?? '',
      name: payload.inviteeName ?? '',
      email: payload.inviteeEmail ?? '',
      role: payload.role ? roleLabel(payload.role, locale) : '',
    },
    locale,
  )

  const managed = {
    label: m.server_mail_tpl_notify_footer_manage({}, { locale }),
    url: `${base}/account#notifications`,
  }
  const lockedBy = payload.lockedBy ?? null
  const token = lockedBy
    ? null
    : signUnsubscribeToken({
        userId: row.userId,
        organizationId:
          payload.recipientRole === 'agency' ? null : row.organizationId,
        event,
      })
  const encoded = token ? encodeURIComponent(token) : null
  // Locked events say who requires them and offer no unsubscribe link.
  const unsubscribe = encoded
    ? {
        label: m.server_mail_tpl_notify_footer_unsubscribe({}, { locale }),
        url: `${base}/unsubscribe?token=${encoded}`,
      }
    : null
  const requiredLine = encoded
    ? null
    : m.server_mail_tpl_notify_footer_required(
        {
          by: lockedBy === 'agency' ? brand.appName : (payload.orgName ?? ''),
        },
        { locale },
      )

  const { html, text } = renderLayout({
    brand,
    preheader: copy.preheader,
    heading: copy.subject,
    paragraphs: [copy.body],
    list: entryLines(payload, locale),
    button: {
      label: copy.button,
      url: buttonUrl(event, payload, row.organizationId, base),
    },
    footer: [
      reasonLine(payload, locale),
      ...(requiredLine ? [requiredLine] : []),
    ],
    footerLinks: unsubscribe ? [managed, unsubscribe] : [managed],
    lang: locale,
  })
  return {
    subject: copy.subject,
    preheader: copy.preheader,
    html,
    text,
    // The unsubscribe token is not a credential, so it is not a redaction secret.
    secrets: [],
    headers: encoded
      ? {
          'List-Unsubscribe': `<${base}/api/notifications/unsubscribe?token=${encoded}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        }
      : undefined,
  }
}

function entryLines(
  payload: NotificationPayload,
  locale: MailLocale,
): string[] {
  const lines = (payload.entries ?? []).map((entry) =>
    m.server_mail_tpl_notify_entries_item(
      {
        change: changeLabel(entry.change, locale),
        collection: entry.collection,
        title: entry.title,
      },
      { locale },
    ),
  )
  if (payload.moreEntries && payload.moreEntries > 0) {
    lines.push(
      m.server_mail_tpl_notify_entries_more(
        { count: String(payload.moreEntries) },
        { locale },
      ),
    )
  }
  return lines
}

function changeLabel(change: string, locale: MailLocale) {
  if (change === 'added') {
    return m.server_mail_tpl_notify_change_added({}, { locale })
  }
  if (change === 'removed') {
    return m.server_mail_tpl_notify_change_removed({}, { locale })
  }
  return m.server_mail_tpl_notify_change_updated({}, { locale })
}

function reasonLine(payload: NotificationPayload, locale: MailLocale) {
  const role = payload.recipientRole
  if (!role || role === 'agency') {
    return m.server_mail_tpl_notify_reason_agency({}, { locale })
  }
  return m.server_mail_tpl_notify_reason_org(
    { org: payload.orgName ?? '', role: roleLabel(role, locale) },
    { locale },
  )
}

/** Invitations have no site, so they go to the dashboard. */
function buttonUrl(
  event: EventKey,
  payload: NotificationPayload,
  organizationId: string | null,
  base: string,
) {
  if (event === 'agency.release.failed') {
    return `${base}/agency/clients/${organizationId ?? ''}`
  }
  if (event === 'invite.accepted' || !payload.siteId) return `${base}/`
  return `${base}/sites/${payload.siteId}/releases`
}
