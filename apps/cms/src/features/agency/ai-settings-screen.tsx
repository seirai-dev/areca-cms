import * as React from 'react'
import {
  ArrowCounterClockwise,
  CaretDown,
  CaretUpDown,
  Check,
  ImageSquare,
  Sparkle,
  Warning,
} from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '#/components/ui/command'
import { ConfirmDialog } from '#/components/ui/confirm-dialog'
import {
  FloatingBar,
  FloatingBarDivider,
  FloatingBarLabel,
} from '#/components/ui/floating-bar'
import { FormField } from '#/components/ui/form-field'
import { Input } from '#/components/ui/input'
import { PageHeader } from '#/components/ui/page-header'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/ui/popover'
import { QueryError } from '#/components/ui/query-error'
import { SettingsSection } from '#/components/ui/settings-section'
import { Skeleton } from '#/components/ui/skeleton'
import { StatusPill } from '#/components/ui/status-pill'
import { Textarea } from '#/components/ui/textarea'
import { Hint } from '#/components/ui/tooltip'
import { aiSeoSuggestionSchema } from '#/lib/ai-seo'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import type { AiModelOption } from '#/server/ai/openrouter'

import { AI_PROMPT_MAX_LENGTH, useAiSettings } from './use-ai-settings'

/** 200000 → "200K", 1048576 → "1M". */
function formatContext(tokens: number) {
  if (tokens >= 1_000_000) return `${+(tokens / 1_000_000).toFixed(1)}M`
  return `${Math.round(tokens / 1_000)}K`
}

/** USD per 1M tokens: "3", "0.15". */
function formatPrice(value: number) {
  return String(+value.toFixed(2))
}

function modelMeta(option: AiModelOption) {
  const parts: string[] = []
  if (option.contextLength) {
    parts.push(
      m.agency_ai_model_context({ size: formatContext(option.contextLength) }),
    )
  }
  if (option.promptPrice !== null && option.completionPrice !== null) {
    parts.push(
      m.agency_ai_model_price({
        input: formatPrice(option.promptPrice),
        output: formatPrice(option.completionPrice),
      }),
    )
  }
  return parts.join(' · ')
}

/**
 * Agency › AI: OpenRouter connection, model and system prompt for AI SEO
 * suggestions. Key, model and prompt are saved together from the floating
 * save pill; the key is write-only and never prefilled.
 */
export function AiSettingsScreen() {
  const form = useAiSettings()
  const { saved, fields, set } = form
  const configured = Boolean(saved?.keyConfigured)
  // Only a key with a model (and a working encryption key) can generate.
  const fullyConfigured = Boolean(
    saved?.keyConfigured && saved.model && saved.encryptionReady,
  )
  const needsModel = configured && !saved?.model
  // Saving now would leave a key without a model (or add one with none).
  const modelMissing =
    (configured || fields.apiKey.trim().length > 0) &&
    fields.model.trim().length === 0

  return (
    <div
      className="grid gap-8 pb-24"
      data-testid="ai-settings-page"
      data-ready={saved ? 'true' : 'false'}
    >
      <PageHeader
        title={m.agency_ai_title()}
        description={m.agency_ai_description()}
      />

      {form.query.isError ? (
        <QueryError
          title={m.agency_ai_load_error()}
          error={form.query.error}
          onRetry={() => void form.query.refetch()}
          retrying={form.query.isFetching}
        />
      ) : !saved ? (
        <div className="grid gap-4" aria-busy="true">
          <Skeleton className="h-48 rounded-card" />
          <Skeleton className="h-48 rounded-card" />
        </div>
      ) : (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            form.submit()
          }}
        >
          <SettingsSection
            title={m.agency_ai_connection_title()}
            description={m.agency_ai_connection_description()}
          >
            <div className="flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-content-center rounded-[11px] bg-background-subtle text-icon-default">
                <Sparkle className="size-5" />
              </span>
              <div className="grid min-w-0 flex-1 gap-0.5">
                <span className="text-headline text-text-primary">
                  {m.agency_ai_provider()}
                </span>
                <span className="truncate text-caption font-normal text-text-muted">
                  {m.agency_ai_provider_body()}
                </span>
              </div>
              {fullyConfigured ? (
                <StatusPill
                  tone="success"
                  icon="check"
                  label={m.agency_ai_connected()}
                  data-testid="ai-status"
                  status="configured"
                />
              ) : needsModel ? (
                <StatusPill
                  tone="warning"
                  icon="dot"
                  label={m.agency_ai_key_needs_model()}
                  data-testid="ai-status"
                  status="needs-model"
                />
              ) : (
                <StatusPill
                  tone="neutral"
                  label={m.agency_ai_not_configured()}
                  data-testid="ai-status"
                  status="not-configured"
                />
              )}
            </div>

            {!saved.encryptionReady ? (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-control bg-status-warning-bg p-3 text-callout text-text-primary"
                data-testid="ai-encryption-warning"
              >
                <Warning className="mt-0.5 size-4 shrink-0 text-icon-warning" />
                <div className="grid gap-0.5">
                  <span className="font-medium">
                    {m.agency_ai_encryption_title()}
                  </span>
                  <span className="text-text-secondary">
                    {m.agency_ai_encryption_body({
                      name: saved.encryptionKeyEnv,
                    })}
                  </span>
                </div>
              </div>
            ) : null}

            <FormField
              label={m.agency_ai_api_key()}
              htmlFor="ai-api-key"
              hint={
                configured
                  ? m.agency_ai_api_key_replace_hint()
                  : m.agency_ai_api_key_hint()
              }
              trailing={
                <a
                  href="https://openrouter.ai/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="text-text-link hover:underline"
                >
                  {m.agency_ai_get_key()}
                </a>
              }
            >
              <Input
                id="ai-api-key"
                data-testid="ai-api-key"
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                disabled={!saved.encryptionReady}
                placeholder={
                  configured
                    ? '••••••••••••••••'
                    : m.agency_ai_api_key_placeholder()
                }
                value={fields.apiKey}
                onChange={(event) => set.setApiKey(event.target.value)}
              />
            </FormField>

            {configured ? (
              <div className="flex">
                <ConfirmDialog
                  title={m.agency_ai_remove_title()}
                  description={m.agency_ai_remove_description()}
                  confirmLabel={m.agency_ai_remove_key()}
                  variant="destructive"
                  onConfirm={async () => {
                    await form.removeKey.mutateAsync()
                  }}
                >
                  <Button
                    type="button"
                    variant="quiet"
                    className="text-text-error hover:text-text-error"
                    data-testid="remove-ai-key"
                    disabled={form.busy}
                  >
                    {m.agency_ai_remove_key()}
                  </Button>
                </ConfirmDialog>
              </div>
            ) : null}
          </SettingsSection>

          <SettingsSection
            title={m.agency_ai_model_title()}
            description={m.agency_ai_model_description()}
          >
            <FormField
              label={m.agency_ai_model_label()}
              htmlFor="ai-model"
              hint={m.agency_ai_model_hint()}
            >
              <ModelCombobox
                id="ai-model"
                value={fields.model}
                onChange={set.setModel}
                models={form.models}
              />
            </FormField>
          </SettingsSection>

          <SettingsSection
            title={m.agency_ai_prompt_title()}
            description={m.agency_ai_prompt_description()}
          >
            <FormField
              label={m.agency_ai_prompt_label()}
              htmlFor="ai-system-prompt"
              error={
                form.promptTooLong
                  ? m.agency_ai_prompt_too_long()
                  : form.promptEmpty
                    ? m.agency_ai_prompt_empty()
                    : undefined
              }
              trailing={m.agency_ai_prompt_count({
                count: fields.prompt.length.toLocaleString(),
                max: AI_PROMPT_MAX_LENGTH.toLocaleString(),
              })}
            >
              <Textarea
                id="ai-system-prompt"
                data-testid="ai-system-prompt"
                rows={16}
                spellCheck={false}
                className="font-mono text-[13px] leading-5"
                value={fields.prompt}
                onChange={(event) => set.setPrompt(event.target.value)}
              />
            </FormField>
            <div className="flex">
              <Button
                type="button"
                variant="quiet"
                size="sm"
                data-testid="reset-ai-prompt"
                disabled={fields.prompt === saved.defaultSystemPrompt}
                onClick={() => set.setPrompt(saved.defaultSystemPrompt)}
              >
                <ArrowCounterClockwise />
                {m.agency_ai_prompt_reset()}
              </Button>
            </div>

            <OutputFormat />
          </SettingsSection>

          <FloatingBar
            open={form.dirty}
            label={m.shared_unsaved_changes()}
            data-testid="ai-save-bar"
          >
            <FloatingBarLabel>{m.shared_unsaved_changes()}</FloatingBarLabel>
            <FloatingBarDivider />
            <Button
              type="button"
              variant="quiet"
              size="sm"
              onClick={form.discard}
              disabled={form.save.isPending}
            >
              {m.settings_discard()}
            </Button>
            <Hint label={modelMissing ? m.agency_ai_save_needs_model() : null}>
              <Button
                type="submit"
                size="sm"
                data-testid="save-ai"
                loading={form.save.isPending}
                disabled={
                  form.promptEmpty || form.promptTooLong || modelMissing
                }
                className="rounded-full"
              >
                {m.agency_ai_save()}
              </Button>
            </Hint>
          </FloatingBar>
        </form>
      )}
    </div>
  )
}

/** The fixed response shape, read-only: the editor parses it field by field. */
function OutputFormat() {
  const fieldList = Object.entries(aiSeoSuggestionSchema.shape)
  return (
    <details
      className="group rounded-control border border-border-default"
      data-testid="ai-output-format"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-callout font-medium text-text-primary [&::-webkit-details-marker]:hidden">
        {m.agency_ai_format_title()}
        <CaretDown className="size-4 text-icon-muted transition-transform group-open:rotate-180" />
      </summary>
      <div className="grid gap-3 border-t border-border-default px-3 py-3">
        <p className="text-callout text-text-secondary">
          {m.agency_ai_format_body()}
        </p>
        <dl className="grid gap-2">
          {fieldList.map(([key, schema]) => (
            <div key={key} className="grid gap-0.5">
              <dt className="font-mono text-[12.5px] text-text-primary">
                {key}
              </dt>
              <dd className="text-caption font-normal text-text-muted">
                {schema.description}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </details>
  )
}

/**
 * Autocomplete over the OpenRouter models. A typed id that is not listed can
 * be used as is, since OpenRouter adds models often.
 */
function ModelCombobox({
  id,
  value,
  onChange,
  models,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  models: ReturnType<typeof useAiSettings>['models']
}) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const options = models.data ?? []
  const current = options.find((option) => option.id === value)
  const typed = search.trim()
  const canUseTyped =
    typed.length > 0 && !options.some((option) => option.id === typed)

  function pick(next: string) {
    onChange(next)
    setOpen(false)
  }

  if (models.isError) {
    return (
      <div className="grid gap-3">
        <QueryError
          title={m.agency_ai_model_load_error()}
          error={models.error}
          onRetry={() => void models.refetch()}
          retrying={models.isFetching}
        />
        <Input
          id={id}
          data-testid="ai-model-input"
          spellCheck={false}
          className="font-mono"
          placeholder="provider/model-name"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    )
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setSearch('')
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          data-testid="ai-model-trigger"
          disabled={models.isPending}
          className="h-auto min-h-10 w-full justify-between py-1.5 text-left font-normal"
        >
          {models.isPending ? (
            <Skeleton className="h-4 w-40" />
          ) : value ? (
            <span className="grid min-w-0">
              <span className="truncate">{current?.name ?? value}</span>
              {current ? (
                <span className="truncate font-mono text-caption text-text-muted">
                  {current.id}
                </span>
              ) : null}
            </span>
          ) : (
            <span className="text-text-muted">
              {m.agency_ai_model_placeholder()}
            </span>
          )}
          <CaretUpDown className="ml-auto shrink-0 text-icon-muted" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) min-w-[min(28rem,calc(100vw-2rem))] overflow-hidden p-0"
      >
        <Command>
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder={m.agency_ai_model_search()}
            data-testid="ai-model-search"
          />
          <CommandList>
            <CommandEmpty className="py-6">
              {m.agency_ai_model_empty()}
            </CommandEmpty>
            {canUseTyped ? (
              <CommandGroup forceMount>
                <CommandItem
                  forceMount
                  value={`use-custom-${typed}`}
                  keywords={[]}
                  onSelect={() => pick(typed)}
                  data-testid="ai-model-custom"
                >
                  <div className="grid min-w-0">
                    <span className="truncate">
                      {m.agency_ai_model_use_custom({ id: typed })}
                    </span>
                    <span className="text-caption text-text-muted">
                      {m.agency_ai_model_custom_hint()}
                    </span>
                  </div>
                </CommandItem>
              </CommandGroup>
            ) : null}
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.id}
                  value={option.id}
                  keywords={[option.name]}
                  onSelect={() => pick(option.id)}
                  className="items-start py-2"
                >
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate">{option.name}</span>
                      {option.supportsImages ? (
                        <ImageSquare
                          aria-label={m.agency_ai_model_images()}
                          className="size-4! text-icon-muted"
                        />
                      ) : null}
                    </span>
                    <span className="truncate font-mono text-caption text-text-muted">
                      {option.id}
                    </span>
                    <span className="text-caption font-normal text-text-muted tnum">
                      {modelMeta(option)}
                    </span>
                  </div>
                  <Check
                    className={cn(
                      'mt-0.5 size-4!',
                      option.id === value ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
