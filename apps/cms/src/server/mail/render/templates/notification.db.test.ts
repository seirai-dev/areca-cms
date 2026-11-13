import { afterEach, describe, expect, it } from 'vitest'

import { db } from '#/db'
import { notification, organization } from '#/db/schema'
import { env } from '#/env'
import { NOTIFICATION_EVENTS } from '#/lib/notifications'
import type { EventKey, NotificationPayload } from '#/lib/notifications'
import { getBranding } from '#/server/admin/branding'
import { createTestSite } from '#/server/content/test-utils'
import {
  addMember,
  makeUser,
  removeUsers,
} from '#/server/notifications/test-utils'

import { MailRenderError, renderTemplate } from '../index.ts'
import type { MailLocale } from '../index.ts'

import { eq } from 'drizzle-orm'

const LOCALES: MailLocale[] = ['en', 'nl', 'tr']
const APP_URL = env.APP_URL.replace(/\/$/, '')
const cleanups: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const run of cleanups.splice(0).reverse()) await run()
})

/** A notification row for `userId` shaped the way `notify()` stores it. */
async function insertNotification(input: {
  event: EventKey
  userId: string
  organizationId: string
  siteId: string
  payload?: Partial<NotificationPayload>
}) {
  const payload: NotificationPayload = {
    siteId: input.siteId,
    siteName: 'Harbour',
    orgName: 'Acme',
    organizationId: input.organizationId,
    recipientRole: 'owner',
    lockedBy: null,
    entries: [{ title: 'Hello world', collection: 'Blog', change: 'added' }],
    ...input.payload,
  }
  const row = (
    await db
      .insert(notification)
      .values({
        userId: input.userId,
        organizationId: input.organizationId,
        siteId: input.siteId,
        event: input.event,
        payload,
        dedupeKey: `${input.event}:${crypto.randomUUID()}:${input.userId}`,
      })
      .returning()
  ).at(0)
  if (!row) throw new Error('notification insert failed')
  return row
}

async function setup() {
  const ctx = await createTestSite()
  const owner = await makeUser({ name: 'Tess Template' })
  await addMember(owner.id, ctx.org.id, 'owner')
  cleanups.push(async () => {
    await db.delete(organization).where(eq(organization.id, ctx.org.id))
    await removeUsers([owner.id, ctx.actor.id])
  })
  return { ...ctx, owner }
}

async function renderFor(
  notificationId: string,
  userId: string,
  locale: MailLocale,
) {
  return renderTemplate(
    'notification',
    { userId, notificationId },
    { locale, brand: await getBranding() },
  )
}

describe('notification email: every event, every language', () => {
  it.each(LOCALES)(
    'renders all events in %s with unsubscribe headers',
    async (locale) => {
      const { owner, org, site } = await setup()

      for (const event of NOTIFICATION_EVENTS) {
        const row = await insertNotification({
          event,
          userId: owner.id,
          organizationId: org.id,
          siteId: site.id,
          payload: event.startsWith('agency.')
            ? { recipientRole: 'agency' }
            : undefined,
        })
        const rendered = await renderFor(row.id, owner.id, locale)

        expect(rendered.subject.length, event).toBeGreaterThan(0)
        expect(rendered.preheader.length, event).toBeGreaterThan(0)
        expect(rendered.html, event).toContain('<!doctype html>')
        expect(rendered.text, event).toContain(rendered.subject)
        expect(rendered.secrets, event).toEqual([])

        const headers = rendered.headers
        expect(headers?.['List-Unsubscribe-Post'], event).toBe(
          'List-Unsubscribe=One-Click',
        )
        expect(headers?.['List-Unsubscribe'], event).toMatch(
          new RegExp(
            `^<${escapeRegExp(APP_URL)}/api/notifications/unsubscribe\\?token=[^>]+>$`,
          ),
        )
        // The footer carries the same token as a link to the unsubscribe page.
        expect(rendered.html, event).toContain(`${APP_URL}/unsubscribe?token=`)
        expect(rendered.html, event).toContain(
          `${APP_URL}/account#notifications`,
        )
      }
    },
  )

  it('writes the subject in the recipient language', async () => {
    const { owner, org, site } = await setup()
    const row = await insertNotification({
      event: 'release.live',
      userId: owner.id,
      organizationId: org.id,
      siteId: site.id,
    })

    expect((await renderFor(row.id, owner.id, 'en')).subject).toBe(
      'Harbour is live',
    )
    expect((await renderFor(row.id, owner.id, 'nl')).subject).toBe(
      'Harbour staat live',
    )
    expect((await renderFor(row.id, owner.id, 'tr')).subject).toBe(
      'Harbour yayında',
    )
  })

  it('lists the changed entries in the body, with a count for the rest', async () => {
    const { owner, org, site } = await setup()
    const row = await insertNotification({
      event: 'release.live',
      userId: owner.id,
      organizationId: org.id,
      siteId: site.id,
      payload: { moreEntries: 3 },
    })

    const rendered = await renderFor(row.id, owner.id, 'en')

    expect(rendered.text).toContain('Added · Blog · Hello world')
    expect(rendered.text).toContain('and 3 more')
  })

  it('links release emails to the site releases and invitations to the dashboard', async () => {
    const { owner, org, site } = await setup()
    const release = await insertNotification({
      event: 'schedule.published',
      userId: owner.id,
      organizationId: org.id,
      siteId: site.id,
    })
    const invite = await insertNotification({
      event: 'invite.accepted',
      userId: owner.id,
      organizationId: org.id,
      siteId: site.id,
      payload: {
        inviteeName: 'Nora',
        inviteeEmail: 'nora@test.local',
        role: 'editor',
      },
    })

    const releaseMail = await renderFor(release.id, owner.id, 'en')
    expect(releaseMail.html).toContain(`${APP_URL}/sites/${site.id}/releases`)
    const inviteMail = await renderFor(invite.id, owner.id, 'en')
    expect(inviteMail.html).toContain(`href="${APP_URL}/"`)
    expect(inviteMail.text).toContain('Nora (nora@test.local)')
  })

  it('links agency alerts to the client page', async () => {
    const { owner, org, site } = await setup()
    const row = await insertNotification({
      event: 'agency.release.failed',
      userId: owner.id,
      organizationId: org.id,
      siteId: site.id,
      payload: { recipientRole: 'agency' },
    })

    const rendered = await renderFor(row.id, owner.id, 'en')

    expect(rendered.html).toContain(`${APP_URL}/agency/clients/${org.id}`)
    expect(rendered.text).toContain(
      "You get this because you're an agency admin.",
    )
  })

  it('does not put the failure reason in a failed-release email', async () => {
    const { owner, org, site } = await setup()
    const row = await insertNotification({
      event: 'release.failed',
      userId: owner.id,
      organizationId: org.id,
      siteId: site.id,
      payload: { entries: [] },
    })

    const rendered = await renderFor(row.id, owner.id, 'en')

    expect(rendered.text).toContain("Harbour didn't go live")
    expect(rendered.text).not.toMatch(/job=|stack|Error:/i)
  })
})

describe('notification email: locked events', () => {
  it('says who requires the email and offers no unsubscribe link or headers', async () => {
    const { owner, org, site } = await setup()
    const row = await insertNotification({
      event: 'release.failed',
      userId: owner.id,
      organizationId: org.id,
      siteId: site.id,
      payload: { lockedBy: 'organization' },
    })

    const rendered = await renderFor(row.id, owner.id, 'en')

    expect(rendered.headers).toBeUndefined()
    expect(rendered.html).not.toContain('unsubscribe?token=')
    expect(rendered.text).toContain('This email is required by Acme.')
  })

  it('names the agency when the agency requires the email', async () => {
    const { owner, org, site } = await setup()
    const brand = await getBranding()
    const row = await insertNotification({
      event: 'release.failed',
      userId: owner.id,
      organizationId: org.id,
      siteId: site.id,
      payload: { lockedBy: 'agency' },
    })

    const rendered = await renderFor(row.id, owner.id, 'en')

    expect(rendered.headers).toBeUndefined()
    expect(rendered.text).toContain(
      `This email is required by ${brand.appName}.`,
    )
  })

  it('renders the required line in Dutch', async () => {
    const { owner, org, site } = await setup()
    const row = await insertNotification({
      event: 'release.failed',
      userId: owner.id,
      organizationId: org.id,
      siteId: site.id,
      payload: { lockedBy: 'organization' },
    })

    const rendered = await renderFor(row.id, owner.id, 'nl')

    expect(rendered.text).toContain(
      'Deze e-mail is verplicht gesteld door Acme.',
    )
  })
})

describe('notification email: failures', () => {
  it('reports a missing notification as a render error', async () => {
    const { owner } = await setup()
    await expect(
      renderFor(crypto.randomUUID(), owner.id, 'en'),
    ).rejects.toBeInstanceOf(MailRenderError)
  })
})

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
