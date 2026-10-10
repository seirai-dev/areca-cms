import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { FormField } from '#/components/ui/form-field'
import { Input } from '#/components/ui/input'
import { SegmentedControl } from '#/components/ui/segmented-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Switch } from '#/components/ui/switch'
import { errorMessage } from '#/lib/admin/helpers'
import { mcpServerName } from '#/lib/mcp-install'
import type { McpInstallInput } from '#/lib/mcp-install'
import { m } from '#/paraglide/messages'

import { AI_APPS, KeyReveal, appLabel } from './key-reveal'
import type { AiApp } from './key-reveal'
import type { McpKeyInput } from './use-mcp-keys'

type ExpiryChoice = '30' | '90' | '365' | 'never'

const EXPIRY_OPTIONS: {
  value: ExpiryChoice
  label: string
  days: 30 | 90 | 365 | null
}[] = [
  { value: '30', label: m.connect_ai_expires_30(), days: 30 },
  { value: '90', label: m.connect_ai_expires_90(), days: 90 },
  { value: '365', label: m.connect_ai_expires_365(), days: 365 },
  { value: 'never', label: m.connect_ai_expires_never(), days: null },
]

export type CreateKeySite = { id: string; name: string; slug: string }
export type CreatedKey = { token: string; endpointUrl: string }

/**
 * "Create AI key" dialog (two steps in one dialog): a short form, then the
 * one-time reveal. Closing the dialog unmounts the flow, so the key never
 * outlives it.
 */
export function CreateKeyDialog({
  open,
  onOpenChange,
  site,
  canAllowGoLive,
  create,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  site: CreateKeySite
  canAllowGoLive: boolean
  create: (input: McpKeyInput) => Promise<CreatedKey>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="connect-ai-create-dialog">
        <CreateKeyFlow
          site={site}
          canAllowGoLive={canAllowGoLive}
          create={create}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function CreateKeyFlow({
  site,
  canAllowGoLive,
  create,
  onClose,
}: {
  site: CreateKeySite
  canAllowGoLive: boolean
  create: (input: McpKeyInput) => Promise<CreatedKey>
  onClose: () => void
}) {
  const nameId = React.useId()
  const appId = React.useId()
  const goLiveId = React.useId()
  const goLiveHintId = React.useId()
  const [name, setName] = React.useState('')
  const [app, setApp] = React.useState<AiApp>('claude-code')
  const [expiry, setExpiry] = React.useState<ExpiryChoice>('90')
  const [goLive, setGoLive] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [install, setInstall] = React.useState<McpInstallInput | null>(null)

  const trimmed = name.trim()
  const expiryDays =
    EXPIRY_OPTIONS.find((item) => item.value === expiry)?.days ?? 90

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!trimmed || pending) return
    setPending(true)
    try {
      const created = await create({
        name: trimmed,
        expiresInDays: expiryDays,
        allowGoLive: canAllowGoLive && goLive,
      })
      setInstall({
        name: mcpServerName(site.slug),
        url: created.endpointUrl,
        key: created.token,
      })
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setPending(false)
    }
  }

  if (install) {
    return (
      <KeyReveal
        install={install}
        siteName={site.name}
        initialApp={app}
        onDone={onClose}
      />
    )
  }

  return (
    <form
      className="grid gap-5"
      onSubmit={submit}
      data-testid="connect-ai-create-form"
    >
      <DialogHeader className="pr-8">
        <DialogTitle>{m.connect_ai_create_title()}</DialogTitle>
        <DialogDescription>
          {m.connect_ai_create_description()}
        </DialogDescription>
      </DialogHeader>

      <FormField label={m.connect_ai_field_name()} htmlFor={nameId} required>
        <Input
          id={nameId}
          value={name}
          maxLength={80}
          autoFocus
          autoComplete="off"
          placeholder={m.connect_ai_field_name_placeholder()}
          onChange={(event) => setName(event.target.value)}
          data-testid="connect-ai-name"
        />
      </FormField>

      <FormField label={m.connect_ai_field_app()} htmlFor={appId}>
        <Select value={app} onValueChange={(value) => setApp(value as AiApp)}>
          <SelectTrigger
            id={appId}
            className="w-full min-h-11 sm:min-h-0"
            data-testid="connect-ai-app"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AI_APPS.map((item) => (
              <SelectItem key={item} value={item}>
                {appLabel(item)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>

      <FormField label={m.connect_ai_field_expires()}>
        <SegmentedControl
          fullWidth
          aria-label={m.connect_ai_field_expires()}
          value={expiry}
          onValueChange={setExpiry}
          options={EXPIRY_OPTIONS.map((item) => ({
            value: item.value,
            label: item.label,
            testId: `connect-ai-expiry-${item.value}`,
          }))}
          className="h-11 sm:h-9"
        />
      </FormField>

      {canAllowGoLive ? (
        <div className="flex items-start justify-between gap-4 rounded-card border border-border-default p-4">
          <div className="grid gap-1">
            <label
              htmlFor={goLiveId}
              className="text-[14px] leading-5 font-medium text-text-primary"
            >
              {m.connect_ai_go_live_label()}
            </label>
            <p id={goLiveHintId} className="text-callout text-text-secondary">
              {m.connect_ai_go_live_hint()}
            </p>
          </div>
          <Switch
            id={goLiveId}
            checked={goLive}
            onCheckedChange={setGoLive}
            aria-describedby={goLiveHintId}
            data-testid="connect-ai-go-live"
            className="mt-0.5 min-h-11 shrink-0 px-1 sm:min-h-0"
          />
        </div>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="quiet"
          size="lg"
          className="min-h-11 sm:min-h-0"
          onClick={onClose}
        >
          {m.shared_cancel()}
        </Button>
        <Button
          type="submit"
          size="lg"
          className="min-h-11 sm:min-h-0"
          disabled={!trimmed}
          loading={pending}
          data-testid="connect-ai-create-submit"
        >
          {m.connect_ai_create_submit()}
        </Button>
      </div>
    </form>
  )
}
