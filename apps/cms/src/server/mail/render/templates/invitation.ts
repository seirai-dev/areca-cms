/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Drizzle row arrays can be empty at runtime, so lookups stay defensive. */
import { eq } from 'drizzle-orm'

import { db } from '#/db'
import { invitation, organization } from '#/db/schema'
import { env } from '#/env'
import { m } from '#/paraglide/messages'

import { MailRenderError } from '../types.ts'
import type {
  Executor,
  MailLocale,
  RenderContext,
  RenderedMail,
} from '../types.ts'
import { renderLayout } from '../layout.ts'

/** What the invitation email says, read from the invitation row at send time. */
export type InvitationMailData = {
  orgName: string
  role: string
  expiresAt: Date
  token: string
}

/** Same name and shape as the other templates: `render(params, ctx)`. */
export async function render(
  params: Record<string, unknown>,
  ctx: RenderContext,
): Promise<RenderedMail> {
  const data = await loadInvitationMail(params, ctx.connection)
  const link = `${env.APP_URL}/invite/${data.token}`
  return buildInvitationMail(data, {
    link,
    locale: ctx.locale,
    brand: ctx.brand,
  })
}

/**
 * Reads the invitation. Fails (not retryable) when it was revoked, accepted or
 * has expired, because the link in the email would not work.
 */
export async function loadInvitationMail(
  params: Record<string, unknown>,
  connection?: Executor,
): Promise<InvitationMailData> {
  const executor = connection ?? db
  const invitationId = String(params.invitationId ?? '')
  const [row] = await executor
    .select({
      organizationId: invitation.organizationId,
      role: invitation.role,
      token: invitation.token,
      expiresAt: invitation.expiresAt,
      acceptedAt: invitation.acceptedAt,
    })
    .from(invitation)
    .where(eq(invitation.id, invitationId))
    .limit(1)
  if (!row) throw new MailRenderError('the invitation no longer exists')
  if (row.acceptedAt) {
    throw new MailRenderError('the invitation was already accepted')
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    throw new MailRenderError('the invitation has expired')
  }
  const [org] = await executor
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, row.organizationId))
    .limit(1)
  if (!org) throw new MailRenderError('the organization no longer exists')
  return {
    orgName: org.name,
    role: row.role,
    expiresAt: row.expiresAt,
    token: row.token,
  }
}

/** Pure: the invitation email for loaded data. `link` is the accept URL. */
export function buildInvitationMail(
  data: InvitationMailData,
  options: { link: string; locale: MailLocale; brand: RenderContext['brand'] },
): RenderedMail {
  const { link, locale, brand } = options
  const org = data.orgName
  const roleLabel =
    data.role === 'owner'
      ? m.people_role_owner({}, { locale })
      : m.people_role_editor({}, { locale })
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(
    data.expiresAt,
  )
  const subject = m.server_invite_subject({ org }, { locale })
  const preheader = m.server_mail_tpl_invite_preheader({ org }, { locale })
  const { html, text } = renderLayout({
    brand,
    preheader,
    heading: subject,
    paragraphs: [
      m.server_invite_body({ org, role: roleLabel }, { locale }),
      m.server_mail_tpl_invite_expiry({ date }, { locale }),
    ],
    button: {
      label: m.server_invite_accept({}, { locale }),
      url: link,
    },
    footer: [m.server_mail_tpl_invite_footer({ org }, { locale })],
    lang: locale,
  })
  return {
    subject,
    preheader,
    html,
    text,
    secrets: [data.token, link],
  }
}
