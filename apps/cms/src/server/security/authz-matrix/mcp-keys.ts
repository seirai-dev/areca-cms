import type * as mcpKeysFns from '#/server/fn/mcp-keys'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '#/db'
import { mcpKey } from '#/db/schema'

import { absent, exists, uniq } from './shared'
import type { MatrixFor } from './shared'

export const mcpKeysRows = {
  listMcpKeysFn: {
    hidden: true,
    policy: 'org-editor',
    doc: 'any site member; editors see only their own keys, owners and agency admins all keys on the site',
    note: 'Editors see only their own keys; owners and agency admins see all keys on the site (scoping asserted separately).',
    prepare: (w) => ({ data: { siteId: w.X.site.id } }),
  },
  createMcpKeyFn: {
    hidden: true,
    policy: 'org-editor',
    doc: 'any site member (MFA for agency admins); agency admins also need a fresh session (`REAUTH_REQUIRED`); editors cannot allow go-live',
    note: 'Any site member can create a personal key. Agency admins need a fresh second factor (reauth). Editors cannot allow go-live (asserted separately).',
    override: { adminStale: 'reauth' },
    prepare: (w) => {
      const name = `authz-key-${uniq()}`
      return {
        data: {
          siteId: w.X.site.id,
          name,
          expiresInDays: 30,
          allowGoLive: false,
        },
        untouched: absent(mcpKey, eq(mcpKey.name, name)),
      }
    },
  },
  revokeMcpKeyFn: {
    hidden: true,
    policy: 'org-editor',
    doc: 'editors revoke their own keys; owners and agency admins any key on the site; other keys are NotFound',
    note: 'Owners and agency admins revoke any key on the site; editors only their own. Other keys answer NotFound.',
    override: { editorX: 'not-found' },
    prepare: async (w) => {
      const key = (
        await db
          .insert(mcpKey)
          .values({
            userId: w.users.ownerX.id,
            siteId: w.X.site.id,
            name: `authz-revoke-${uniq()}`,
            tokenPrefix: 'areca_mcp_authz',
            tokenHash: `authz-${crypto.randomUUID()}`,
            expiresAt: new Date(Date.now() + 86_400_000),
          })
          .returning()
      ).at(0)
      if (!key) throw new Error('mcp key insert failed')
      return {
        data: { id: key.id },
        untouched: exists(
          mcpKey,
          and(eq(mcpKey.id, key.id), isNull(mcpKey.revokedAt)),
        ),
      }
    },
  },
  listAgencyMcpKeysFn: {
    policy: 'agency',
    doc: "agency admin (MFA); the caller's own agency keys (no site); other roles are refused",
    note: 'Agency admins see their own agency keys (no site). Other roles are refused.',
  },
  createAgencyMcpKeyFn: {
    policy: 'agency-fresh',
    doc: 'agency admin (MFA) with fresh session (step-up); agency keys have no go-live option, but the agency connector can always go live (`siteActorFor` sets `allowGoLive: true`, as for the agency admin in the CMS)',
    note: 'Agency keys need an agency admin with MFA and a fresh second factor (reauth). They have no go-live option, but the agency connector can always go live (allowGoLive is true for agency actors).',
    prepare: () => {
      const name = `authz-agency-key-${uniq()}`
      return {
        data: { name, expiresInDays: 30 },
        untouched: absent(mcpKey, eq(mcpKey.name, name)),
      }
    },
  },
  revokeAgencyMcpKeyFn: {
    policy: 'agency',
    doc: "agency admin revokes their own agency key; another admin's key is NotFound",
    note: "An agency admin revokes their own agency key; another admin's key answers NotFound.",
    override: { adminStale: 'not-found' },
    prepare: async (w) => {
      const key = (
        await db
          .insert(mcpKey)
          .values({
            userId: w.users.adminMfa.id,
            scope: 'agency',
            siteId: null,
            name: `authz-agency-revoke-${uniq()}`,
            tokenPrefix: 'areca_mcp_agcy',
            tokenHash: `authz-${crypto.randomUUID()}`,
            expiresAt: new Date(Date.now() + 86_400_000),
          })
          .returning()
      ).at(0)
      if (!key) throw new Error('agency mcp key insert failed')
      return {
        data: { id: key.id },
        untouched: exists(
          mcpKey,
          and(eq(mcpKey.id, key.id), isNull(mcpKey.revokedAt)),
        ),
      }
    },
  },
} satisfies MatrixFor<typeof mcpKeysFns>
