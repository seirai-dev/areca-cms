import type * as mcpOauthFns from '#/server/fn/mcp-oauth'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '#/db'
import { mcpConnection, oauthClient } from '#/db/schema'

import { exists, uniq } from './shared'
import type { MatrixFor } from './shared'

export const mcpOauthRows = {
  getOAuthConsentFn: {
    // Returns a reason instead of throwing: signed_out, invalid_request,
    // unknown_site or no_access. Those outcomes are asserted separately in
    // mcp-oauth.test.ts; this row only checks that it reads nothing it
    // should not, and that a bogus query is refused without a side effect.
    policy: 'public',
    doc: 'anyone; signed-out, invalid or tampered requests and non-members get a reason instead of data; nothing is changed',
    note: 'Read-only. Non-members get reason no_access and an agency admin without 2FA gets the MFA message, both asserted separately.',
    prepare: () => ({ data: { query: 'client_id=nope&sig=nope&exp=1' } }),
  },
  approveOAuthConsentFn: {
    hidden: true,
    policy: 'org-editor',
    doc: 'site access first (NotFound for other tenants); agency admins need a fresh second factor; editors cannot allow go-live; the signed query must name this site',
    tolerant: true,
    note: 'Site access (NotFound for other tenants, 2FA for agency admins, fresh session for agency approval) is checked before the signed query. Editors cannot go live (asserted separately).',
    override: { adminStale: 'reauth' },
    prepare: (w) => ({
      data: {
        query: 'client_id=nope&sig=nope&exp=1',
        siteId: w.X.site.id,
        allowGoLive: false,
      },
    }),
  },
  denyOAuthConsentFn: {
    policy: 'user',
    doc: 'any signed-in user may refuse a request addressed to them; the query must be signed by the server',
    tolerant: true,
    note: 'Any signed-in user may refuse a request addressed to them; the query must still be signed by the server.',
    prepare: () => ({ data: { query: 'client_id=nope&sig=nope&exp=1' } }),
  },
  listMcpConnectionsFn: {
    hidden: true,
    policy: 'org-editor',
    doc: 'editors see only their own connected apps; owners and agency admins all on the site',
    note: 'Editors see only their own connections; owners and agency admins see all (scoping asserted separately).',
    prepare: (w) => ({ data: { siteId: w.X.site.id } }),
  },
  revokeMcpConnectionFn: {
    hidden: true,
    policy: 'org-editor',
    doc: 'editors disconnect their own apps; owners and agency admins any app on the site; others are NotFound',
    note: 'Owners and agency admins disconnect any app on the site; editors only their own. Other connections answer NotFound.',
    override: { editorX: 'not-found' },
    prepare: async (w) => {
      const clientId = `authz-client-${uniq()}`
      await db.insert(oauthClient).values({
        clientId,
        redirectUris: ['http://localhost:9999/callback'],
        name: 'Authz app',
      })
      const connection = (
        await db
          .insert(mcpConnection)
          .values({
            userId: w.users.ownerX.id,
            siteId: w.X.site.id,
            clientId,
            clientName: 'Authz app',
          })
          .returning()
      ).at(0)
      if (!connection) throw new Error('mcp connection insert failed')
      return {
        data: { id: connection.id },
        untouched: exists(
          mcpConnection,
          and(
            eq(mcpConnection.id, connection.id),
            isNull(mcpConnection.revokedAt),
          ),
        ),
      }
    },
  },
  listAgencyMcpConnectionsFn: {
    policy: 'agency',
    doc: "agency admin (MFA); the caller's own agency apps (no site); other roles are refused",
    note: 'Agency admins see their own agency apps (no site). Other roles are refused.',
  },
  approveAgencyOAuthConsentFn: {
    policy: 'agency-fresh',
    doc: 'agency admin (MFA) with fresh session (step-up) approves the agency connector for an app; the signed query must name the agency resource; agency connections have no go-live tick, and the agency connector can always go live (`allowGoLive: true`)',
    tolerant: true,
    note: 'Agency admins with MFA and a fresh second factor (reauth) approve the agency connector; the signed query is checked after access. Agency approvals have no go-live tick; the agency connector can always go live (allowGoLive is true for agency actors).',
    prepare: () => ({
      data: { query: 'client_id=nope&sig=nope&exp=1' },
    }),
  },
  revokeAgencyMcpConnectionFn: {
    policy: 'agency',
    doc: "agency admin revokes their own agency app; another admin's app is NotFound",
    note: "An agency admin disconnects their own agency app; another admin's app answers NotFound.",
    override: { adminStale: 'not-found' },
    prepare: async (w) => {
      const clientId = `authz-agency-client-${uniq()}`
      await db.insert(oauthClient).values({
        clientId,
        redirectUris: ['http://localhost:9999/callback'],
        name: 'Authz agency app',
      })
      const connection = (
        await db
          .insert(mcpConnection)
          .values({
            userId: w.users.adminMfa.id,
            scope: 'agency',
            siteId: null,
            clientId,
            clientName: 'Authz agency app',
          })
          .returning()
      ).at(0)
      if (!connection) throw new Error('agency mcp connection insert failed')
      return {
        data: { id: connection.id },
        untouched: exists(
          mcpConnection,
          and(
            eq(mcpConnection.id, connection.id),
            isNull(mcpConnection.revokedAt),
          ),
        ),
      }
    },
  },
} satisfies MatrixFor<typeof mcpOauthFns>
