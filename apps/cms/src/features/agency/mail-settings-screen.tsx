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
  mailStatusCompactLabel,
  mailStatusLabel,
  timelineStateLabel,
} from './mail-settings-logic'
import type {
  MailEmailKind,
  MailFieldKey,
  TimelineStep,
} from './mail-settings-logic'
import { PausedJobsSection } from './paused-jobs-section'
import {
  useMailSettings,
  useMailSettingsQuery,
  useRecentEmails,
} from './use-mail-settings'
import type { MailActionFailure, MailStatus } from './use-mail-settings'
import type { RecentEmail } from '#/server/mail/outbox-views'

function secureLabel(secure: MailSecure) {
  if (secure === 'starttls') return m.agency_mail_secure_starttls()
  if (secure === 'tls') return m.agency_mail_secure_tls()
  return m.agency_mail_secure_none()
}

/** The element each save-blocking field is focused by. */
const MAIL_FIELD_IDS: Record<MailFieldKey, string> = {
  host: 'mail-host',
  port: 'mail-port',
  fromAddress: 'mail-from',
}

/**
 * Agency › Mail: how invitations and notifications are sent. The server
 * settings are either the Mail settings saved here or the environment; the
 * form is a draft that Verify and Send test email run on as typed.
 */
export function MailSettingsScreen() {
  const query = useMailSettingsQuery()
  if (!query.data) {
    return (
      <div
        className="grid gap-8 pb-24"
        data-testid="mail-settings-page"
        data-ready="false"
      >
        <PageHeader
          title={m.agency_mail_title()}
          description={m.agency_mail_description()}
        />
        {query.isError ? (
          <MailLoadError query={query} />
        ) : (
          <div className="grid gap-4" aria-busy="true">
            <Skeleton className="h-48 rounded-card" />
            <Skeleton className="h-64 rounded-card" />
          </div>
        )}
      </div>
    )
  }
  return <MailSettingsEditor query={query} saved={query.data} />
}

type MailSettingsQuery = ReturnType<typeof useMailSettingsQuery>

function MailLoadError({ query }: { query: MailSettingsQuery }) {
  return <QueryError title={m.agency_mail_load_error()} query={query} />
}

/** The form, mounted once the settings have loaded; the draft starts from them. */
function MailSettingsEditor({
  query,
  saved,
}: {
  query: MailSettingsQuery
  saved: MailStatus
}) {
  const form = useMailSettings(saved)
  const { fields, update } = form
  const [envConfirmOpen, setEnvConfirmOpen] = React.useState(false)
  const busy =
    form.verify.isPending ||
    form.sendTest.isPending ||
    form.save.isPending ||
    form.useEnvironment.isPending
  const barOpen = form.dirty && !form.usingEnvironment
  const missing = form.problems.length

  /**
   * Opened from the environment, the form is a proposal: Save is what switches
   * sending to it, so the bar says so rather than "unsaved changes".
   */
  function barText() {
    if (missing === 1) return m.agency_mail_fix_one()
    if (missing > 1) return m.agency_mail_fix_many({ count: String(missing) })
    if (saved.source === 'env') return m.agency_mail_save_to_use()
    return m.shared_unsaved_changes()
  }

  /** Shows every error, then moves focus to the first field that blocks a save. */
  function revealProblems() {
    form.revealProblems()
    if (form.problems.length === 0) return
    const field = document.getElementById(MAIL_FIELD_IDS[form.problems[0]])
    field?.scrollIntoView({ block: 'center' })
    field?.focus({ preventScroll: true })
  }

  return (
    <div
      className={cn('grid gap-8 pb-24', barOpen && 'max-md:pb-40')}
      data-testid="mail-settings-page"
      data-ready="true"
    >
      <PageHeader
        title={m.agency_mail_title()}
        description={m.agency_mail_description()}
      />

      {query.isError ? (
        <MailLoadError query={query} />
      ) : (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            if (form.valid) form.save.mutate(false)
            else revealProblems()
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
                    error={
                      form.showError('host')
                        ? m.agency_mail_host_required()
                        : undefined
                    }
                  >
                    <Input
                      id="mail-host"
                      data-testid="mail-host"
                      spellCheck={false}
                      autoComplete="off"
                      placeholder="smtp.example.com"
                      value={fields.host}
                      onChange={(event) => update({ host: event.target.value })}
                      onBlur={() => form.touch('host')}
                    />
                  </FormField>
                  <FormField
                    label={m.agency_mail_field_port()}
                    htmlFor="mail-port"
                    error={
                      form.showError('port')
                        ? m.agency_mail_port_invalid()
                        : undefined
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
                      onBlur={() => form.touch('port')}
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
                    form.showError('fromAddress')
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
                    onBlur={() => form.touch('fromAddress')}
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
                  <div className="grid gap-2.5">
                    <div className="grid gap-2 min-[400px]:grid-cols-2 sm:flex sm:flex-wrap sm:items-center">
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-full sm:w-auto"
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
                        className="w-full sm:w-auto"
                        data-testid="mail-send-test"
                        loading={form.sendTest.isPending}
                        disabled={!form.valid || busy}
                        onClick={() => form.sendTest.mutate()}
                      >
                        <PaperPlaneTilt />
                        {m.agency_mail_send_test()}
                      </Button>
                    </div>
                    {saved.settings?.lastVerifiedAt ? (
                      <p className="text-caption font-normal text-text-secondary">
                        {m.agency_mail_last_verified({
                          time: formatRelativeTime(
                            saved.settings.lastVerifiedAt,
                          ),
                        })}
                      </p>
                    ) : saved.settings?.host ? (
                      <p className="text-caption font-normal text-text-secondary">
                        {m.agency_mail_never_verified()}
                      </p>
                    ) : null}
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
            open={barOpen}
            label={barText()}
            fullWidthOnMobile
            data-testid="mail-save-bar"
          >
            <FloatingBarLabel className="max-md:basis-full">
              {missing > 0 ? (
                <button
                  type="button"
                  data-testid="mail-fix-fields"
                  className="block max-w-full truncate text-left font-medium text-text-link underline-offset-4 hover:underline"
                  onClick={revealProblems}
                >
                  {barText()}
                </button>
              ) : (
                barText()
              )}
            </FloatingBarLabel>
            <FloatingBarDivider className="max-md:hidden" />
            <Button
              type="button"
              variant="quiet"
              size="sm"
              className="max-md:flex-1"
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
              className="rounded-full max-md:min-w-28 max-md:flex-1"
            >
              {m.agency_mail_save()}
            </Button>
          </FloatingBar>
        </form>
      )}

      <AgencyClientDefaultsSection />
      <AgencyAlertsSection />

      <RecentEmailsSection />

      <PausedJobsSection />

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
      <p
        className="text-callout text-text-secondary"
        data-testid="mail-env-values"
      >
        {m.agency_mail_env_not_configured()}
      </p>
    )
  }
  return (
    <dl
      className="divide-y divide-border-default"
      data-testid="mail-env-values"
    >
      <EnvironmentRow label={m.agency_mail_field_host()} value={env.host} />
      <EnvironmentRow
        label={m.agency_mail_field_port()}
        value={String(env.port)}
      />
      <EnvironmentRow
        label={m.agency_mail_field_secure()}
        value={secureLabel(env.secure)}
      />
      <EnvironmentRow label={m.agency_mail_field_from()} value={env.from} />
      <EnvironmentRow
        label={m.agency_mail_field_username()}
        value={env.username ?? '—'}
      />
      <EnvironmentRow
        label={m.agency_mail_field_password()}
        value={
          env.passwordSet
            ? m.agency_mail_env_set()
            : m.agency_mail_env_not_set()
        }
      />
    </dl>
  )
}

/** One environment value: label on the left, the value wraps on the right. */
function EnvironmentRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <dt className="shrink-0 text-callout text-text-secondary">{label}</dt>
      <dd className="min-w-0 text-right text-[14px] leading-5 break-all text-text-primary">
        {value}
      </dd>
    </div>
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
      bare
      title={m.agency_mail_recent_title()}
      description={m.agency_mail_recent_description()}
      data-testid="mail-recent"
    >
      <div className="surface-card overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-border-default px-4 py-2.5">
          <SegmentedControl
            size="sm"
            value={filter}
            onValueChange={setFilter}
            aria-label={m.agency_mail_recent_title()}
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
            aria-label={m.agency_mail_refresh()}
            disabled={recent.isFetching}
            onClick={() => void recent.refetch()}
          >
            <ArrowClockwise
              className={cn(recent.isFetching && 'animate-spin')}
            />
            <span className="max-sm:sr-only">{m.agency_mail_refresh()}</span>
          </Button>
        </div>

        {recent.isError ? (
          <QueryError title={m.agency_mail_recent_error()} query={recent} />
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
            className="divide-y divide-border-default"
            data-testid="mail-recent-list"
          >
            {rows.map((email) => (
              <RecentEmailRow key={email.id} email={email} />
            ))}
          </ul>
        )}
      </div>
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
  skipped: 'neutral',
}

/**
 * Phones: recipient, subject, then the status, time and delivery dots on the
 * third line. From md: recipient and status on the first line, subject, then
 * time and dots. The recipient always gets the full first line on phones.
 */
function RecentEmailRow({ email }: { email: RecentEmail }) {
  const kind = emailStatusKind(email)
  const steps = emailTimeline(email)
  const status = mailStatusLabel(email)
  return (
    <li
      className="grid min-w-0 grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-x-1.5 gap-y-1 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:gap-x-3"
      data-testid="mail-recent-row"
      data-status={kind}
    >
      <span
        className="col-span-full row-start-1 min-w-0 truncate text-[14px] leading-5 font-medium text-text-primary md:col-span-1 md:col-start-1"
        title={email.to}
      >
        {email.to}
      </span>
      <p
        className="col-span-full row-start-2 min-w-0 truncate text-callout text-text-secondary md:col-span-2 md:col-start-1"
        title={email.subject}
      >
        {email.subject}
      </p>
      <Tag
        tone={TAG_TONE[kind]}
        className="col-start-1 row-start-3 md:col-start-2 md:row-start-1 md:justify-self-end"
        title={status}
        data-testid="mail-recent-status"
      >
        {kind === 'retrying' ? (
          <>
            <span aria-hidden="true" className="md:hidden">
              {mailStatusCompactLabel(email)}
            </span>
            <span className="max-md:sr-only">{status}</span>
          </>
        ) : (
          status
        )}
      </Tag>
      <time
        dateTime={new Date(email.createdAt).toISOString()}
        title={absoluteTimeLabel(email.createdAt)}
        className="col-start-2 row-start-3 text-caption whitespace-nowrap text-text-secondary md:col-start-1 md:row-start-3"
      >
        {formatRelativeTime(email.createdAt, { withinDays: 7 })}
      </time>
      <MailTimeline
        steps={steps}
        className="col-start-4 row-start-3 justify-self-end md:col-start-2 md:row-start-3"
      />
      {email.error && (kind === 'failed' || kind === 'retrying') ? (
        <div className="col-span-full row-start-4 mt-1 grid gap-0.5">
          <span className="text-callout text-text-secondary break-words">
            {email.error.message}
          </span>
          <span className="font-mono text-caption text-text-secondary break-all">
            {m.agency_mail_reference({ id: email.id })}
          </span>
        </div>
      ) : null}
    </li>
  )
}

const STEP_LABEL = {
  queued: () => m.agency_mail_step_queued(),
  retrying: () => m.agency_mail_step_retrying(),
  sent: () => m.agency_mail_step_sent(),
  failed: () => m.agency_mail_step_failed(),
} satisfies Record<TimelineStep['key'], () => string>

/**
 * Three dots: queued → retrying → sent or failed. Colour is never the only
 * cue. The whole row is one named image, so a tooltip and a screen reader both
 * say what each delivery step is and whether it happened.
 */
function MailTimeline({
  steps,
  className,
}: {
  steps: TimelineStep[]
  className?: string
}) {
  const summary = `${m.agency_mail_timeline_label()}: ${steps
    .map(
      (step) => `${STEP_LABEL[step.key]()} (${timelineStateLabel(step.state)})`,
    )
    .join('; ')}`
  return (
    <span
      role="img"
      aria-label={summary}
      title={summary}
      className={cn('flex items-center gap-1 md:gap-1.5', className)}
    >
      {steps.map((step, index) => (
        <span
          key={step.key}
          aria-hidden="true"
          className="flex items-center gap-1 md:gap-1.5"
          data-state={step.state}
        >
          {index > 0 ? (
            <span className="h-px w-2 bg-border-default md:w-5" />
          ) : null}
          <span
            className={cn(
              'size-2.5 rounded-full',
              DOT_CLASS[step.state],
              step.state === 'current' && 'motion-safe:animate-pulse',
            )}
          />
        </span>
      ))}
    </span>
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
