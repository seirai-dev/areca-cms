import { readFileSync } from 'node:fs'
import { parse } from 'dotenv'
import { describe, expect, it } from 'vitest'

import { aiSeoSuggestionSchema } from '#/lib/ai-seo'
import type { Field } from '#/lib/types'

/*
 * Opt-in live check against the real OpenRouter model configured in the dev
 * database. It costs real money, so it only runs when RUN_LIVE_AI=1:
 *
 *   RUN_LIVE_AI=1 pnpm exec vitest run src/server/ai/live.test.ts
 *
 * The configured key is encrypted with the dev AI_SETTINGS_ENCRYPTION_KEY from
 * .env.local. Vitest's test env sets a different placeholder key, so the dev
 * value is read from .env.local here (the same source the dev server uses)
 * before the settings module loads its env.
 */
describe.skipIf(process.env.RUN_LIVE_AI !== '1')(
  'live AI SEO generation',
  () => {
    it('generates a schema-valid suggestion for a small article', async () => {
      const devEnv = parse(readFileSync('.env.local'))
      if (devEnv.AI_SETTINGS_ENCRYPTION_KEY) {
        process.env.AI_SETTINGS_ENCRYPTION_KEY =
          devEnv.AI_SETTINGS_ENCRYPTION_KEY
      }
      const { loadAiRuntimeConfig } = await import('./settings.ts')
      const { generateSeoSuggestion } = await import('./seo-generate.ts')

      const config = await loadAiRuntimeConfig()
      expect(config, 'AI is configured in the dev database').not.toBeNull()

      const fields: Field[] = [
        { key: 'title', label: 'Title', type: 'text', required: true },
        { key: 'slug', label: 'Slug', type: 'slug', required: true },
        { key: 'excerpt', label: 'Excerpt', type: 'textarea' },
        { key: 'body', label: 'Body', type: 'richtext', required: true },
      ]
      const result = await generateSeoSuggestion({
        config: config!,
        sitePrompt: null,
        site: {
          name: 'Tidewater Tea',
          productionUrl: 'https://tidewater.example',
          organizationId: 'live-test-no-assets',
        },
        collectionLabel: 'Articles',
        routePattern: '/blog/$slug',
        fields,
        slug: 'why-we-steep-longer',
        data: {
          title: 'Why we steep oolong for longer',
          excerpt: 'A short note on our steeping times for oolong.',
          body: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'We steep our oolong for three minutes instead of two. The longer infusion brings out the floral notes and softens the bitterness of the leaves.',
                  },
                ],
              },
            ],
          },
        },
      })

      expect(result.usedImages).toBe(false)
      expect(aiSeoSuggestionSchema.safeParse(result.suggestion).success).toBe(
        true,
      )
      expect(result.suggestion.title.trim().length).toBeGreaterThan(0)
      expect(result.suggestion.description.trim().length).toBeGreaterThan(0)
    }, 180_000)
  },
)
