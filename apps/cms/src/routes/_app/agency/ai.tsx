import { createFileRoute } from '@tanstack/react-router'

import { AiSettingsScreen } from '#/features/agency/ai-settings-screen'

/** `/agency/ai`: OpenRouter key, model and system prompt for AI SEO. */
export const Route = createFileRoute('/_app/agency/ai')({
  component: AiSettingsScreen,
})
