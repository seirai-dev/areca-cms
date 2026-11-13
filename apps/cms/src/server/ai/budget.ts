import { allowUserAction } from '#/server/http/rate-limit.server'

import { AiGenerationError } from './seo-generate'
import { loadAiRuntimeConfig } from './settings'
import type { AiRuntimeConfig } from './settings'

/** SEO suggestions and translations share one hourly budget per person. */
const AI_BUCKET = 'ai-seo'
const AI_RULE = { limit: 30, windowSeconds: 60 * 60 }

/**
 * The AI settings for one paid call by this person. Refused when AI is not
 * set up, or when the person has used up their hourly budget.
 */
export async function requireAiBudget(
  userId: string,
): Promise<AiRuntimeConfig> {
  const config = await loadAiRuntimeConfig()
  if (!config) {
    throw new AiGenerationError(
      'AI is not set up yet. An agency admin can configure it under Agency → AI.',
      'not_configured',
    )
  }
  if (!(await allowUserAction(AI_BUCKET, userId, AI_RULE))) {
    throw new AiGenerationError(
      'You have reached the hourly limit for AI suggestions. Try again later.',
      'rate_limited',
    )
  }
  return config
}
