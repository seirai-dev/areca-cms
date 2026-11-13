import type * as aiFns from '#/server/fn/ai'
import { eq } from 'drizzle-orm'
import { aiSettings } from '#/db/schema'

import { absent, uniq } from './shared'
import type { MatrixFor } from './shared'

export const aiRows = {
  getAiSettingsFn: {
    policy: 'agency',
    doc: 'agency admin (MFA); never returns the API key',
  },
  saveAiSettingsFn: {
    policy: 'agency',
    doc: 'agency admin (MFA); `agency-fresh` when the API key is set or removed',
    note: 'Model/prompt edits; saving or removing the API key needs a fresh second factor (agency-fresh).',
    prepare: () => {
      const model = `authz/${uniq()}`
      return {
        data: { model },
        untouched: absent(aiSettings, eq(aiSettings.model, model)),
      }
    },
  },
  listAiModelsFn: {
    policy: 'agency',
    tolerant: true,
    note: 'Fetches the public OpenRouter catalogue; network failures are not authorization outcomes.',
  },
  getAiAvailabilityFn: {
    policy: 'user',
    doc: 'any signed-in user (boolean only)',
    note: 'Only a boolean; reveals nothing about the key, model or prompt.',
  },
  generateEntrySeoFn: {
    hidden: true,
    policy: 'org-editor',
    doc: 'org member (editor/owner) or agency admin; NotFound outside the org; 30/hour per user',
    tolerant: true,
    note: 'Allowed callers get "AI is not set up" (no key in the test world); denied callers must not reach the provider.',
    prepare: (w) => ({
      data: {
        siteId: w.X.site.id,
        collectionKey: 'articles',
        data: { title: 'AI', slug: `ai-${uniq()}` },
      },
    }),
  },
} satisfies MatrixFor<typeof aiFns>
