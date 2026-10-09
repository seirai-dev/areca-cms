import * as React from 'react'
import { toast } from 'sonner'

import { errorMessage } from '#/lib/admin/helpers'
import { FormField } from '#/components/ui/form-field'
import { SettingsSection } from '#/components/ui/settings-section'
import { Textarea } from '#/components/ui/textarea'
import { m } from '#/paraglide/messages'

import { SettingsSaveBar } from './settings-save-bar'
import type { SiteRecord, useSiteSettings } from './use-site-settings'

const AI_PROMPT_MAX_LENGTH = 20_000

/** Settings › AI: site-specific instructions appended to the agency prompt. */
export function AiTab({
  site,
  settings,
}: {
  site: SiteRecord
  settings: ReturnType<typeof useSiteSettings>
}) {
  const formId = React.useId()
  const saved = site.aiPrompt ?? ''
  const [prompt, setPrompt] = React.useState(saved)
  const [error, setError] = React.useState<string | undefined>()

  // Follow the server copy until the user starts editing.
  React.useEffect(() => setPrompt(saved), [saved])

  const dirty = prompt.trim() !== saved.trim()

  function discard() {
    setPrompt(saved)
    setError(undefined)
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (prompt.length > AI_PROMPT_MAX_LENGTH) {
      setError(m.site_ai_too_long())
      return
    }
    setError(undefined)
    try {
      const next = prompt.trim()
      await settings.update.mutateAsync({ aiPrompt: next || null })
      setPrompt(next)
      toast.success(m.sites_updated())
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div data-testid="settings-ai">
      <form id={formId} noValidate onSubmit={onSubmit}>
        <SettingsSection
          title={m.site_ai_title()}
          description={m.site_ai_description()}
        >
          <FormField
            label={m.site_ai_label()}
            htmlFor="settings-ai-prompt"
            description={m.site_ai_help()}
            error={error}
            trailing={m.agency_ai_prompt_count({
              count: prompt.length.toLocaleString(),
              max: AI_PROMPT_MAX_LENGTH.toLocaleString(),
            })}
          >
            <Textarea
              id="settings-ai-prompt"
              data-testid="settings-ai-prompt"
              rows={8}
              value={prompt}
              placeholder={m.site_ai_placeholder()}
              aria-invalid={error ? true : undefined}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </FormField>
        </SettingsSection>
      </form>

      <SettingsSaveBar
        dirty={dirty}
        saving={settings.update.isPending}
        onDiscard={discard}
        formId={formId}
        saveTestId="save-ai"
      />
    </div>
  )
}
