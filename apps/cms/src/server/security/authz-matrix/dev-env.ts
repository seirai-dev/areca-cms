import type * as devEnvFns from '#/server/fn/dev-env'
import { eq } from 'drizzle-orm'
import { db } from '#/db'
import { site } from '#/db/schema'
import { forkDevEnvironment } from '#/server/dev-env/fork'

import { absent, exists } from './shared'
import type { MatrixFor } from './shared'

export const devEnvRows = {
  getDevEnvironmentFn: {
    policy: 'agency',
    doc: "agency admin (MFA); a production site's development environment, or null",
    prepare: (w) => ({ data: { siteId: w.X.site.id } }),
  },
  createDevEnvironmentFn: {
    policy: 'agency',
    doc: 'agency admin (MFA); no step-up (throwaway dev env); production sites only',
    prepare: async (w) => {
      const s = await w.fresh.site()
      return {
        data: { siteId: s.id },
        untouched: absent(site, eq(site.parentSiteId, s.id)),
      }
    },
  },
  refreshDevEnvironmentFn: {
    policy: 'agency',
    doc: "agency admin (MFA); no step-up; discards the dev env's content and forks again",
    prepare: async (w) => {
      const s = await w.fresh.site()
      const dev = await forkDevEnvironment(w.users.adminMfa, s.id)
      const before = (
        await db
          .select({ updatedAt: site.updatedAt })
          .from(site)
          .where(eq(site.id, dev.id))
      ).at(0)
      return {
        data: { devSiteId: dev.id },
        untouched: async () => {
          const now = (
            await db
              .select({ updatedAt: site.updatedAt })
              .from(site)
              .where(eq(site.id, dev.id))
          ).at(0)
          return now?.updatedAt.getTime() === before?.updatedAt.getTime()
        },
      }
    },
  },
  deleteDevEnvironmentFn: {
    policy: 'agency',
    doc: 'agency admin (MFA); no step-up; deletes the dev env, nothing is archived',
    prepare: async (w) => {
      const s = await w.fresh.site()
      const dev = await forkDevEnvironment(w.users.adminMfa, s.id)
      return {
        data: { devSiteId: dev.id },
        untouched: exists(site, eq(site.id, dev.id)),
      }
    },
  },
  getDevSiteSyncStatusFn: {
    policy: 'agency',
    doc: 'agency admin (MFA); unpushed and production change counts of a dev env',
    prepare: async (w) => {
      const s = await w.fresh.site()
      const dev = await forkDevEnvironment(w.users.adminMfa, s.id)
      return { data: { devSiteId: dev.id } }
    },
  },
  getPushPlanFn: {
    policy: 'agency',
    doc: 'agency admin (MFA); the push plan items and the plan hash of a dev env. Writes nothing',
    prepare: async (w) => {
      const s = await w.fresh.site()
      const dev = await forkDevEnvironment(w.users.adminMfa, s.id)
      return { data: { devSiteId: dev.id } }
    },
  },
  pushToProductionFn: {
    // The plan hash is stale on purpose: nothing is written, and an allowed
    // caller gets the "plan changed" refusal.
    policy: 'agency-fresh',
    doc: 'agency admin (MFA) with fresh session (step-up); pushes the selected plan items to production; refused when the plan hash is stale',
    tolerant: true,
    prepare: async (w) => {
      const s = await w.fresh.site()
      const dev = await forkDevEnvironment(w.users.adminMfa, s.id)
      return {
        data: {
          devSiteId: dev.id,
          planHash: 'stale',
          exclude: [],
          apply: [],
          goLive: false,
        },
        untouched: async () => {
          const row = (
            await db
              .select({ lastPushedAt: site.lastPushedAt })
              .from(site)
              .where(eq(site.id, dev.id))
          ).at(0)
          return row?.lastPushedAt == null
        },
      }
    },
  },
  copyEntryToProductionFn: {
    policy: 'agency-fresh',
    doc: 'agency admin (MFA) with fresh session (step-up); copies one dev entry or section to production as its draft; refused on a schema mismatch, on a production change since the last sync (unless `overwrite`), and on a scheduled production entry',
    tolerant: true,
    prepare: async (w) => {
      const s = await w.fresh.site()
      const dev = await forkDevEnvironment(w.users.adminMfa, s.id)
      return {
        // No such entry: an admin gets NotFound, which is a tolerant "allowed".
        data: {
          devEntryId: 'missing-entry',
          markReady: false,
          overwrite: false,
        },
        untouched: async () => {
          const row = (
            await db
              .select({ lastPushedAt: site.lastPushedAt })
              .from(site)
              .where(eq(site.id, dev.id))
          ).at(0)
          return row?.lastPushedAt == null
        },
      }
    },
  },
} satisfies MatrixFor<typeof devEnvFns>
