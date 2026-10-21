import * as React from 'react'
import {
  ArrowClockwise,
  CheckCircle,
  EnvelopeSimple,
  PaperPlaneTilt,
  PlugsConnected,
  WarningCircle,
} from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'
import { ConfirmDialog } from '#/components/ui/confirm-dialog'
import {
  FloatingBar,
  FloatingBarDivider,
  FloatingBarLabel,
} from '#/components/ui/floating-bar'
import { FormField } from '#/components/ui/form-field'
import { Input } from '#/components/ui/input'
import { InsetList, InsetRow } from '#/components/ui/inset-list'
import { PageHeader } from '#/components/ui/page-header'
import { QueryError } from '#/components/ui/query-error'
import { SegmentedControl } from '#/components/ui/segmented-control'
import { SettingsSection } from '#/components/ui/settings-section'
import { Skeleton } from '#/components/ui/skeleton'
import { Switch } from '#/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Tag } from '#/components/ui/tag'
import { EmptyState } from '#/components/ui/empty-state'
import {
  AgencyAlertsSection,
  AgencyClientDefaultsSection,
} from '#/features/notifications/agency-notification-sections'
import { absoluteTimeLabel, formatRelativeTime } from '#/lib/relative-time'
import type { MailSecure } from '#/lib/types'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

import {
  emailStatusKind,
  emailTimeline,
  isMailSecure,
  mailKindLabel,
  mailStatusLabel,
} from './mail-settings-logic'
import type { MailEmailKind, TimelineStep } from './mail-settings-logic'
import { useMailSettings, useRecentEmails } from './use-mail-settings'
import type { MailActionFailure, MailStatus } from './use-mail-settings'
import type { RecentEmail } from '#/server/mail/outbox'

function secureLabel(secure: MailSecure) {
  if (secure === 'starttls') return m.agency_mail_secure_starttls()
  if (secure === 'tls') return m.agency_mail_secure_tls()
  return m.agency_mail_secure_none()
}

/**
 * Agency › Mail: how invitations and notifications are sent. The server
 * settings are either the Mail settings saved here or the environment; the
 * form is a draft that Verify and Send test email run on as typed.
 */
export function MailSettingsScreen() {
  const form = useMailSettings()
  const { saved, fields, update } = form
  const [envConfirmOpen, setEnvConfirmOpen] = React.useState(false)
  const busy =
    form.verify.isPending ||
    form.sendTest.isPending ||
    form.save.isPending ||
    form.useEnvironment.isPending

  return (
    <div
      className="grid gap-8 pb-24"
      data-testid="mail-settings-page"
      data-ready={saved ? 'true' : 'false'}
    >
      <PageHeader
        title={m.agency_mail_title()}
        description={m.agency_mail_description()}
      />

      {form.query.isError ? (
        <QueryError
          title={m.agency_mail_load_error()}
          error={form.query.error}
          onRetry={() => void form.query.refetch()}
          retrying={form.query.isFetching}
        />
      ) : !saved ? (
        <div className="grid gap-4" aria-busy="true">
          <Skeleton className="h-48 rounded-card" />
          <Skeleton className="h-64 rounded-card" />
        </div>
      ) : (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            if (form.valid) form.save.mutate(false)
          }}
        >
          <SettingsSection
            title={m.agency_mail_server_title()}
            description={m.agency_mail_server_description()}
          >
            <StatusLine status={saved} />

            <div className="flex items-start justify-between gap-4">
              <label htmlFor="mail-use-env" className="grid min-w-0 gap-0.5">
                <span className="text-[14px] leading-5 font-medium text-text-primary">
                  {m.agency_mail_env_switch()}
                </span>
                <span className="text-caption font-normal text-text-muted">
                  {m.agency_mail_env_switch_hint()}
                </span>
              </label>
              <Switch
                id="mail-use-env"
                data-testid="mail-use-env"
                checked={form.usingEnvironment}
                disabled={!saved.env || busy}
                onCheckedChange={(checked) => {
                  if (checked) setEnvConfirmOpen(true)
                  else form.openForm()
                }}
              />
            </div>

            {form.usingEnvironment ? (
              <EnvironmentValues status={saved} />
            ) : (
              <div className="grid gap-5">
                {saved.source === 'env' ? (
                  <p className="text-callout text-text-secondary">
                    {m.agency_mail_env_form_hint()}
                  </p>
                ) : null}

                <div className="grid gap-5 min-[560px]:grid-cols-[minmax(0,1fr)_128px]">
                  <FormField
                    label={m.agency_mail_field_host()}
                    htmlFor="mail-host"
                  >
                    <Input
                      id="mail-host"
                      data-testid="mail-host"
                      spellCheck={false}
                      autoComplete="off"
                      placeholder="smtp.example.com"
                      value={fields.host}
                      onChange={(event) => update({ host: event.target.value })}
                    />
                  </FormField>
                  <FormField
                    label={m.agency_mail_field_port()}
                    htmlFor="mail-port"
                    error={
                      form.portValid || fields.port === ''
                        ? undefined
                        : m.agency_mail_port_invalid()
                    }
                  >
                    <Input
                      id="mail-port"
                      data-testid="mail-port"
                      inputMode="numeric"
                      autoComplete="off"
                      className="tnum"
                      value={fields.port}
                      onChange={(event) => update({ port: event.target.value })}
                    />
                  </FormField>
                </div>

                <FormField
                  label={m.agency_mail_field_secure()}
                  htmlFor="mail-secure"
                  hint={m.agency_mail_secure_help()}
                >
                  <Select
                    value={fields.secure}
                    onValueChange={(next) => {
                      // Radix Select can report '' while items mount; keep the
                      // loaded value instead of clearing it.
                      if (isMailSecure(next)) form.setSecure(next)
                    }}
                  >
                    <SelectTrigger
                      id="mail-secure"
                      data-testid="mail-secure"
                      className="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem
                        value="starttls"
                        data-testid="mail-secure-starttls"
                      >
                        {secureLabel('starttls')}
                      </SelectItem>
                      <SelectItem value="tls" data-testid="mail-secure-tls">
                        {secureLabel('tls')}
                      </SelectItem>
                      <SelectItem value="none" data-testid="mail-secure-none">
                        {secureLabel('none')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </FormField>

                <FormField
                  label={m.agency_mail_field_username()}
                  htmlFor="mail-username"
                  hint={m.agency_mail_username_hint()}
                >
                  <Input
                    id="mail-username"
                    data-testid="mail-username"
                    spellCheck={false}
                    autoComplete="off"
                    value={fields.username}
                    onChange={(event) =>
                      update({ username: event.target.value })
                    }
                  />
                </FormField>

                <FormField
                  label={m.agency_mail_field_password()}
                  htmlFor="mail-password"
                  hint={
                    saved.encryptionReady
                      ? undefined
                      : m.agency_mail_password_unavailable({
                          name: saved.encryptionKeyEnv,
                        })
                  }
                  trailing={
                    saved.settings?.passwordSet && !fields.clearPassword ? (
                      <button
                        type="button"
                        data-testid="mail-password-remove"
                        className="text-text-link hover:underline"
                        onClick={() =>
                          update({ clearPassword: true, password: '' })
                        }
                      >
                        {m.agency_mail_password_remove()}
                      </button>
                    ) : fields.clearPassword ? (
                      <button
                        type="button"
                        data-testid="mail-password-keep"
                        className="text-text-link hover:underline"
                        onClick={() => update({ clearPassword: false })}
                      >
                        {m.agency_mail_password_keep_again()}
                      </button>
                    ) : null
                  }
                >
                  <Input
                    id="mail-password"
                    data-testid="mail-password"
                    type="password"
                    autoComplete="new-password"
                    spellCheck={false}
                    disabled={!saved.encryptionReady || fields.clearPassword}
                    placeholder={
                      saved.settings?.passwordSet
                        ? m.agency_mail_password_keep()
                        : undefined
                    }
                    value={fields.password}
                    onChange={(event) =>
                      update({ password: event.target.value })
                    }
                  />
                </FormField>
                {fields.clearPassword ? (
                  <p className="-mt-3 text-caption font-normal text-text-muted">
                    {m.agency_mail_password_removed()}
                  </p>
                ) : null}

                <FormField
                  label={m.agency_mail_field_from()}
                  htmlFor="mail-from"
                  hint={m.agency_mail_from_hint()}
                  error={
                    fields.fromAddress.trim() !== '' && !form.fromValid
                      ? m.agency_mail_from_invalid()
                      : undefined
                  }
                >
                  <Input
                    id="mail-from"
                    data-testid="mail-from"
                    type="email"
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="cms@example.com"
                    value={fields.fromAddress}
                    onChange={(event) =>
                      update({ fromAddress: event.target.value })
                    }
                  />
                </FormField>

                <FormField
                  label={m.agency_mail_field_reply_to()}
                  htmlFor="mail-reply-to"
                  hint={m.agency_mail_reply_to_hint()}
                >
                  <Input
                    id="mail-reply-to"
                    data-testid="mail-reply-to"
                    type="email"
                    spellCheck={false}
                    autoComplete="off"
                    value={fields.replyTo}
                    onChange={(event) =>
                      update({ replyTo: event.target.value })
                    }
                  />
                </FormField>

                <div className="grid gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      data-testid="mail-verify"
                      loading={form.verify.isPending}
                      disabled={!form.valid || busy}
                      onClick={() => form.verify.mutate()}
                    >
                      <PlugsConnected />
                      {m.agency_mail_verify()}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      data-testid="mail-send-test"
                      loading={form.sendTest.isPending}
                      disabled={!form.valid || busy}
                      onClick={() => form.sendTest.mutate()}
                    >
                      <PaperPlaneTilt />
                      {m.agency_mail_send_test()}
                    </Button>
                    <span className="text-caption font-normal text-text-muted">
                      {saved.settings?.lastVerifiedAt
                        ? m.agency_mail_last_verified({
                            time: formatRelativeTime(
                              saved.settings.lastVerifiedAt,
                            ),
                          })
                        : saved.settings?.host
                          ? m.agency_mail_never_verified()
                          : null}
                    </span>
                  </div>

                  {form.verifyResult?.ok ? (
                    <p
                      role="status"
                      data-testid="mail-verify-result"
                      className="flex items-center gap-2 text-callout text-text-primary"
                    >
                      <CheckCircle
                        weight="fill"
                        className="size-4 shrink-0 text-icon-success"
                      />
                      {m.agency_mail_verify_ok()}
                    </p>
                  ) : form.verifyResult ? (
                    <FailureNotice
                      testId="mail-verify-result"
                      title={m.agency_mail_verify_failed()}
                      failure={form.verifyResult.error}
                    />
                  ) : null}

                  {form.testFailure ? (
                    <FailureNotice
                      testId="mail-test-result"
                      title={m.agency_mail_test_failed()}
                      failure={form.testFailure}
                    />
                  ) : null}
                </div>
              </div>
            )}
          </SettingsSection>

          <FloatingBar
            open={form.dirty && !form.usingEnvironment}
            label={m.shared_unsaved_changes()}
            data-testid="mail-save-bar"
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
            <Button
              type="submit"
              size="sm"
              data-testid="save-mail"
              loading={form.save.isPending}
              disabled={!form.valid || busy}
              className="rounded-full"
            >
              {m.agency_mail_save()}
            </Button>
          </FloatingBar>
        </form>
      )}

      {saved ? <AgencyClientDefaultsSection /> : null}
      {saved ? <AgencyAlertsSection /> : null}

      {saved ? <RecentEmailsSection /> : null}

      <ConfirmDialog
        open={envConfirmOpen}
        onOpenChange={setEnvConfirmOpen}
        title={m.agency_mail_env_confirm_title()}
        description={m.agency_mail_env_confirm_description()}
        confirmLabel={m.agency_mail_env_confirm_action()}
        onConfirm={async () => {
          await form.useEnvironment.mutateAsync().catch(() => undefined)
        }}
      />

      <ConfirmDialog
        open={form.saveFailure !== null}
        onOpenChange={(next) => {
          if (!next) form.clearSaveFailure()
        }}
        title={m.agency_mail_save_failed_title()}
        description={m.agency_mail_save_failed_description({
          message: form.saveFailure?.message ?? '',
        })}
        confirmLabel={m.agency_mail_save_anyway()}
        cancelLabel={m.agency_mail_keep_editing()}
        testId="mail-save-anyway-dialog"
        onConfirm={async () => {
          await form.save.mutateAsync(true).catch(() => undefined)
        }}
      />
    </div>
  )
}

/** One line on what is sending mail right now, with a hint when none is set. */
function StatusLine({ status }: { status: MailStatus }) {
  const label =
    status.source === 'settings'
      ? m.agency_mail_status_settings()
      : status.source === 'env'
        ? m.agency_mail_status_env()
        : m.agency_mail_status_none()
  const configured = status.source !== 'none'
  return (
    <div className="flex items-start gap-3" data-testid="mail-status">
      <span
        className={cn(
          'mt-0.5 grid size-10 shrink-0 place-content-center rounded-[11px] text-icon-default',
          configured ? 'bg-background-subtle' : 'bg-status-warning-bg',
        )}
      >
        <EnvelopeSimple
          className={cn('size-5', !configured && 'text-icon-warning')}
        />
      </span>
      <div className="grid min-w-0 gap-0.5">
        <span className="text-headline text-text-primary">{label}</span>
        {configured ? null : (
          <span className="text-callout text-text-secondary">
            {m.agency_mail_status_none_hint()}
          </span>
        )}
      </div>
    </div>
  )
}

/** The environment values, read-only. Passwords are only ever "Set" or "Not set". */
function EnvironmentValues({ status }: { status: MailStatus }) {
  const env = status.env
  if (!env) {
    return (
      <InsetList data-testid="mail-env-values">
        <InsetRow title={m.agency_mail_env_not_configured()} inset={false} />
      </InsetList>
    )
  }
  return (
    <InsetList data-testid="mail-env-values">
      <InsetRow
        title={m.agency_mail_field_host()}
        trailing={env.host}
        inset={false}
      />
      <InsetRow
        title={m.agency_mail_field_port()}
        trailing={String(env.port)}
        inset={false}
      />
      <InsetRow
        title={m.agency_mail_field_secure()}
        trailing={secureLabel(env.secure)}
        inset={false}
      />
      <InsetRow
        title={m.agency_mail_field_from()}
        trailing={env.from}
        inset={false}
      />
      <InsetRow
        title={m.agency_mail_field_username()}
        trailing={env.username ?? '—'}
        inset={false}
      />
      <InsetRow
        title={m.agency_mail_field_password()}
        trailing={
          env.passwordSet
            ? m.agency_mail_env_set()
            : m.agency_mail_env_not_set()
        }
        inset={false}
      />
    </InsetList>
  )
}

/** A failed verify or test: the readable message, then the reference for support. */
function FailureNotice({
  title,
  failure,
  testId,
}: {
  title: string
  failure: MailActionFailure
  testId: string
}) {
  return (
    <div
      role="alert"
      data-testid={testId}
      className="flex items-start gap-2.5 rounded-control bg-status-error-bg p-3 text-callout text-text-primary"
    >
      <WarningCircle className="mt-0.5 size-4 shrink-0 text-icon-error" />
      <div className="grid min-w-0 gap-0.5">
        <span className="font-medium">{title}</span>
        <span className="text-text-secondary break-words">
          {failure.message}
        </span>
        <span className="text-caption font-normal text-text-muted font-mono">
          {m.agency_mail_reference({ id: failure.ref })}
        </span>
      </div>
    </div>
  )
}

/** Last 50 outbox rows, All or Failed. */
function RecentEmailsSection() {
  const [filter, setFilter] = React.useState<'all' | 'failed'>('all')
  const recent = useRecentEmails(filter === 'failed')
  const rows = recent.data ?? []

  return (
    <SettingsSection
      id="recent-emails"
      title={m.agency_mail_recent_title()}
      description={m.agency_mail_recent_description()}
      data-testid="mail-recent"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          size="sm"
          value={filter}
          onValueChange={setFilter}
          options={[
            {
              value: 'all',
              label: m.agency_mail_filter_all(),
              testId: 'mail-filter-all',
            },
            {
              value: 'failed',
              label: m.agency_mail_filter_failed(),
              testId: 'mail-filter-failed',
            },
          ]}
        />
        <Button
          type="button"
          variant="quiet"
          size="sm"
          data-testid="mail-refresh"
          disabled={recent.isFetching}
          onClick={() => void recent.refetch()}
        >
          <ArrowClockwise className={cn(recent.isFetching && 'animate-spin')} />
          {m.agency_mail_refresh()}
        </Button>
      </div>

      {recent.isError ? (
        <QueryError
          title={m.agency_mail_recent_error()}
          error={recent.error}
          onRetry={() => void recent.refetch()}
          retrying={recent.isFetching}
        />
      ) : recent.isPending ? (
        <div className="grid gap-2" aria-busy="true">
          <Skeleton className="h-16 rounded-control" />
          <Skeleton className="h-16 rounded-control" />
        </div>
      ) : rows.length === 0 ? (
        filter === 'failed' ? (
          <EmptyState
            size="sm"
            tone="neutral"
            title={m.agency_mail_empty_failed()}
          />
        ) : (
          <EmptyState
            size="sm"
            tone="neutral"
            title={m.agency_mail_empty_title()}
            description={m.agency_mail_empty_description()}
          />
        )
      ) : (
        <ul
          className="overflow-hidden surface-card"
          data-testid="mail-recent-list"
        >
          {rows.map((email) => (
            <RecentEmailRow key={email.id} email={email} />
          ))}
        </ul>
      )}
    </SettingsSection>
  )
}

const TAG_TONE: Record<
  MailEmailKind,
  'success' | 'neutral' | 'warning' | 'error'
> = {
  sent: 'success',
  queued: 'neutral',
  retrying: 'warning',
  failed: 'error',
}

function RecentEmailRow({ email }: { email: RecentEmail }) {
  const kind = emailStatusKind(email)
  const steps = emailTimeline(email)
  return (
    <li
      className="relative grid gap-3 border-b border-border-default px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-6"
      data-testid="mail-recent-row"
      data-status={kind}
    >
      <div className="grid min-w-0 gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-[14px] leading-5 font-medium text-text-primary">
            {mailKindLabel(email.kind)}
          </span>
          <Tag tone={TAG_TONE[kind]} data-testid="mail-recent-status">
            {mailStatusLabel(email)}
          </Tag>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-caption text-text-muted">
          <span className="truncate text-text-secondary">{email.to}</span>
          <span aria-hidden="true">·</span>
          <time
            dateTime={new Date(email.createdAt).toISOString()}
            title={absoluteTimeLabel(email.createdAt)}
          >
            {formatRelativeTime(email.createdAt)}
          </time>
        </div>
        {email.error && (kind === 'failed' || kind === 'retrying') ? (
          <div className="grid gap-0.5 pt-0.5">
            <span className="text-callout text-text-secondary break-words">
              {email.error.message}
            </span>
            <span className="font-mono text-caption text-text-muted break-all">
              {m.agency_mail_reference({ id: email.id })}
            </span>
          </div>
        ) : null}
      </div>
      <MailTimeline steps={steps} />
    </li>
  )
}

const STEP_LABEL = {
  queued: () => m.agency_mail_step_queued(),
  retrying: () => m.agency_mail_step_retrying(),
  sent: () => m.agency_mail_step_sent(),
  failed: () => m.agency_mail_step_failed(),
} satisfies Record<TimelineStep['key'], () => string>

/** Three dots: queued → retrying → sent or failed. Colour is never the only cue. */
function MailTimeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol
      aria-label={m.agency_mail_timeline_label()}
      className="flex shrink-0 items-center gap-1.5 md:justify-end"
    >
      {steps.map((step, index) => (
        <li
          key={step.key}
          className="flex items-center gap-1.5"
          data-state={step.state}
        >
          {index > 0 ? (
            <span aria-hidden="true" className="h-px w-5 bg-border-default" />
          ) : null}
          <span
            aria-hidden="true"
            title={STEP_LABEL[step.key]()}
            className={cn(
              'size-2.5 rounded-full',
              DOT_CLASS[step.state],
              step.state === 'current' && 'motion-safe:animate-pulse',
            )}
          />
          <span className="sr-only">{STEP_LABEL[step.key]()}</span>
        </li>
      ))}
    </ol>
  )
}

const DOT_CLASS: Record<TimelineStep['state'], string> = {
  done: 'bg-icon-muted',
  current: 'bg-status-warning',
  skipped:
    'border border-dashed border-border-strong bg-transparent opacity-60',
  pending: 'border border-border-strong bg-transparent',
  failed: 'bg-status-error',
}
