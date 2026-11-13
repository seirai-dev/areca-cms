import { eq } from 'drizzle-orm'

import { db } from '#/db'
import { invitation, organization } from '#/db/schema'
import { env } from '#/env'
import { m } from '#/paraglide/messages'
import { decryptSecret } from '#/server/security/secret-encryption'
import { secretsEncryptionKey } from '#/server/security/secrets-key'

import { MailRenderError } from '../types.ts'
import type { DbExecutor } from '#/db'
import type { MailLocale, RenderContext, RenderedMail } from '../types.ts'
import { renderLayout } from '../layout.ts'

import { PARAMS_SECRET_CONTEXT } from './password-reset.ts'

/** What the invitation email says, read from the invitation row at send time. */
export type InvitationMailData = {
  orgName: string
  role: string
  expiresAt: Date
}

/** The accept URL for a raw invitation token. */
export function invitationAcceptUrl(token: string) {
  return `${env.APP_URL}/invite/${token}`
}

/**
 * The raw token comes from the outbox params, never from the database (only
 * its hash is stored). `encryptedToken` is present when a secrets key existed
 * at queue time; `token` is passed for the immediate send only.
 */
function resolveToken(params: Record<string, unknown>): string {
  if (typeof params.encryptedToken === 'string') {
    const key = secretsEncryptionKey()
    if (!key) throw new MailRenderError('the invitation key is not set')
    try {
      return decryptSecret(params.encryptedToken, key, PARAMS_SECRET_CONTEXT)
    } catch {
      throw new MailRenderError('the invitation link could not be read')
    }
  }
  if (typeof params.token === 'string' && params.token) return params.token
  throw new MailRenderError('the invitation link is no longer available')
}

/** Same name and shape as the other templates: `render(params, ctx)`. */
export async function render(
  params: Record<string, unknown>,
  ctx: RenderContext,
): Promise<RenderedMail> {
  const data = await loadInvitationMail(params, ctx.connection)
  const token = resolveToken(params)
  return buildInvitationMail(data, {
    link: invitationAcceptUrl(token),
    token,
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
  connection?: DbExecutor,
): Promise<InvitationMailData> {
  const executor = connection ?? db
  const invitationId = String(params.invitationId ?? '')
  const row = (
    await executor
      .select({
        organizationId: invitation.organizationId,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
        acceptedAt: invitation.acceptedAt,
      })
      .from(invitation)
      .where(eq(invitation.id, invitationId))
      .limit(1)
  ).at(0)
  if (!row) throw new MailRenderError('the invitation no longer exists')
  if (row.acceptedAt) {
    throw new MailRenderError('the invitation was already accepted')
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    throw new MailRenderError('the invitation has expired')
  }
  const org = (
    await executor
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, row.organizationId))
      .limit(1)
  ).at(0)
  if (!org) throw new MailRenderError('the organization no longer exists')
  return {
    orgName: org.name,
    role: row.role,
    expiresAt: row.expiresAt,
  }
}

/** Pure: the invitation email for loaded data. `link` is the accept URL. */
export function buildInvitationMail(
  data: InvitationMailData,
  options: {
    link: string
    token: string
    locale: MailLocale
    brand: RenderContext['brand']
  },
): RenderedMail {
  const { link, token, locale, brand } = options
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
    secrets: [token, link],
  }
}
