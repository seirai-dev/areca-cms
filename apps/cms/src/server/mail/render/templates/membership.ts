/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Drizzle row arrays can be empty at runtime, so lookups stay defensive. */
import { eq } from 'drizzle-orm'

import { db } from '#/db'
import { organization } from '#/db/schema'
import { env } from '#/env'
import { m } from '#/paraglide/messages'

import { renderLayout } from '../layout.ts'
import { MailRenderError } from '../types.ts'
import type { RenderContext, RenderedMail } from '../types.ts'

import { loadRecipient, roleLabel } from './shared.ts'

/** Sent to someone an owner or agency admin removed. Names are captured at removal. */
export async function renderRemoved(
  params: Record<string, unknown>,
  ctx: RenderContext,
): Promise<RenderedMail> {
  const { locale, brand } = ctx
  await loadRecipient(params.userId, ctx.connection)
  const org = String(params.orgName ?? '')
  const actor = String(params.actorName ?? '')
  const subject = m.server_mail_tpl_membership_removed_subject(
    { org },
    { locale },
  )
  const preheader = m.server_mail_tpl_membership_removed_preheader(
    { org },
    { locale },
  )
  const { html, text } = renderLayout({
    brand,
    preheader,
    heading: subject,
    paragraphs: [
      m.server_mail_tpl_membership_removed_body({ actor, org }, { locale }),
    ],
    footer: [m.server_mail_tpl_membership_removed_footer({ org }, { locale })],
    lang: locale,
  })
  return { subject, preheader, html, text, secrets: [] }
}

/** Sent when an owner changes someone's role. The org name is read at send time. */
export async function renderRoleChanged(
  params: Record<string, unknown>,
  ctx: RenderContext,
): Promise<RenderedMail> {
  const { locale, brand } = ctx
  await loadRecipient(params.userId, ctx.connection)
  const [org] = await (ctx.connection ?? db)
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, String(params.organizationId ?? '')))
    .limit(1)
  if (!org) throw new MailRenderError('the organization no longer exists')
  const role = roleLabel(String(params.role ?? ''), locale)
  const previousRole = roleLabel(String(params.previousRole ?? ''), locale)
  const subject = m.server_mail_tpl_membership_role_changed_subject(
    { org: org.name },
    { locale },
  )
  const preheader = m.server_mail_tpl_membership_role_changed_preheader(
    { org: org.name, role },
    { locale },
  )
  const { html, text } = renderLayout({
    brand,
    preheader,
    heading: subject,
    paragraphs: [
      m.server_mail_tpl_membership_role_changed_body(
        { org: org.name, role, previousRole },
        { locale },
      ),
    ],
    button: {
      label: m.server_mail_tpl_open_dashboard({}, { locale }),
      url: `${env.APP_URL.replace(/\/$/, '')}/`,
    },
    footer: [
      m.server_mail_tpl_membership_role_changed_footer(
        { org: org.name },
        { locale },
      ),
    ],
    lang: locale,
  })
  return { subject, preheader, html, text, secrets: [] }
}
