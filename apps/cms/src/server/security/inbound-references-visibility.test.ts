import type * as MailConfig from '#/server/mail/config'
import type * as MailTransport from '#/server/mail/transport'
/* eslint-disable @typescript-eslint/no-unnecessary-condition -- row lookups after .returning()/.select() are checked defensively */

import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { db } from '#/db'
import { entry } from '#/db/schema'
import type { EntryData, Field } from '#/lib/types'
import { createTestGlobal } from '#/server/content/test-utils'
import * as contentFns from '#/server/fn/content'

import { callServerFn, seedWorld } from './authz-harness'
import type { World } from './authz-harness'

// Must run before `#/env` is first imported: guards read ADMIN_MFA_REQUIRED.
vi.hoisted(() => {
  process.env.ADMIN_MFA_REQUIRED = 'true'
})
vi.mock('#/lib/auth', async () => (await import('./authz-state')).fakeAuth())
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
  getCookie: () => null,
}))
vi.mock('@tanstack/react-start', async (importOriginal) =>
  (await import('./authz-start-patch')).patchStart(await importOriginal()),
)
vi.mock('#/server/mail/config', async (importOriginal) => ({
  ...(await importOriginal<typeof MailConfig>()),
  isMailConfigured: async () => true,
  resolveMailConfig: async () => ({
    source: 'env' as const,
    host: 'mail.test',
    port: 587,
    secure: 'starttls' as const,
    username: null,
    password: null,
    from: 'cms@areca.test',
    replyTo: null,
  }),
}))
vi.mock('#/server/mail/transport', async (importOriginal) => ({
  ...(await importOriginal<typeof MailTransport>()),
  sendMail: async () => ({ messageId: 'test-message' }),
}))

const dbName = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? '').pathname.slice(1)
  } catch {
    return ''
  }
})()
// Never run against a developer database: only throwaway/isolated names.
const runnable = /authz|test|e2e|bench|tmp/i.test(dbName)

const HERO_FIELDS: Field[] = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  {
    key: 'hero',
    label: 'Hero article',
    type: 'reference',
    collection: 'articles',
  },
]

describe.skipIf(!runnable)(
  'listInboundReferencesFn visibility of disabled site content',
  () => {
    let w: World
    let referrerIds: { enabled: string; disabled: string }
    let disabledTitle: string

    beforeAll(async () => {
      w = await seedWorld()
      const target = w.X.entry.id
      const suffix = w.run
      disabledTitle = `Hidden hero ${suffix}`

      const enabled = await createTestGlobal(w.X.site.id, {
        key: `visibleHero${suffix.replace(/[^a-z0-9]/gi, '')}`,
        label: 'Visible hero',
        enabled: true,
        fields: HERO_FIELDS,
      })
      const disabled = await createTestGlobal(w.X.site.id, {
        key: `hiddenHero${suffix.replace(/[^a-z0-9]/gi, '')}`,
        label: 'Hidden hero',
        enabled: false,
        fields: HERO_FIELDS,
      })
      const draft = (title: string): EntryData => ({
        title,
        hero: target,
      })
      await db
        .update(entry)
        .set({ draftData: draft('Visible hero copy') })
        .where(eq(entry.id, enabled.entry.id))
      await db
        .update(entry)
        .set({ draftData: draft(disabledTitle) })
        .where(eq(entry.id, disabled.entry.id))
      referrerIds = { enabled: enabled.entry.id, disabled: disabled.entry.id }
    }, 60_000)
    afterAll(async () => {
      await w?.destroy()
    })

    const inboundFor = async (actor: keyof World['sessions']) => {
      const outcome = await callServerFn(
        contentFns.listInboundReferencesFn as Parameters<
          typeof callServerFn
        >[0],
        { id: w.X.entry.id },
        w.sessions[actor],
      )
      expect(outcome.error, `as ${actor}`).toBeUndefined()
      return outcome.result as Array<{
        id: string
        title: string
        collectionKey: string
      }>
    }

    it('editors and owners do not see a disabled section that references the entry', async () => {
      for (const actor of ['editorX', 'ownerX'] as const) {
        const inbound = await inboundFor(actor)
        const ids = inbound.map((row) => row.id)
        expect(ids, `as ${actor}`).not.toContain(referrerIds.disabled)
        expect(JSON.stringify(inbound), `as ${actor}`).not.toContain(
          disabledTitle,
        )
        // An enabled section that references the entry stays visible.
        expect(ids, `as ${actor}`).toContain(referrerIds.enabled)
      }
    })

    it('agency admins still see the disabled section', async () => {
      const inbound = await inboundFor('adminMfa')
      expect(inbound.map((row) => row.id)).toContain(referrerIds.disabled)
    })
  },
)
