import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { useStepUp } from '#/features/security/step-up'
import { errorMessage } from '#/lib/admin/helpers'
import type { MailSecure } from '#/lib/types'
import { m } from '#/paraglide/messages'
import {
  getMailHealthFn,
  getMailSettingsFn,
  listRecentEmailsFn,
  saveMailSettingsFn,
  sendTestEmailFn,
  useEnvironmentMailFn,
  verifyMailDraftFn,
} from '#/server/fn/mail'
import type { getMailSettingsStatus } from '#/server/mail/settings'

import { parsePort, portForEncryption } from './mail-settings-logic'

export const mailSettingsQueryKey = ['mail-settings'] as const
export const mailHealthQueryKey = ['mail-health'] as const
export const mailRecentQueryKey = (failedOnly: boolean) =>
  ['mail-recent', failedOnly ? 'failed' : 'all'] as const

/** Text fields as the inputs hold them. The port stays a string until sent. */
export type MailFields = {
  host: string
  port: string
  secure: MailSecure
  username: string
  password: string
  clearPassword: boolean
  fromAddress: string
  replyTo: string
}

export type MailStatus = Awaited<ReturnType<typeof getMailSettingsStatus>>
type MailSettingsView = NonNullable<MailStatus['settings']>
type MailEnvView = NonNullable<MailStatus['env']>

/** A failed check, as the server returns it. `ref` ties it to the log. */
export type MailActionFailure = {
  code: string
  message: string
  ref: string
  detail: string
}

export type MailVerifyResult =
  { ok: true } | { ok: false; error: MailActionFailure }

const DEFAULT_PORT = 587

function emptyFields(): MailFields {
  return {
    host: '',
    port: String(DEFAULT_PORT),
    secure: 'starttls',
    username: '',
    password: '',
    clearPassword: false,
    fromAddress: '',
    replyTo: '',
  }
}

/**
 * A stored row can exist without a connection (switching to the environment
 * writes only `enabled`), so every connection column may be null here.
 */
function fieldsFromSettings(settings: MailSettingsView | null): MailFields {
  if (!settings) return emptyFields()
  return {
    host: settings.host ?? '',
    port: String(settings.port ?? DEFAULT_PORT),
    secure: settings.secure ?? 'starttls',
    username: settings.username ?? '',
    password: '',
    clearPassword: false,
    fromAddress: settings.fromAddress ?? '',
    replyTo: settings.replyTo ?? '',
  }
}

function fieldsFromEnv(env: MailEnvView): MailFields {
  return {
    host: env.host,
    port: String(env.port),
    secure: env.secure,
    username: env.username ?? '',
    password: '',
    clearPassword: false,
    fromAddress: env.from,
    replyTo: env.replyTo ?? '',
  }
}

/** Everything but the password, which is never part of the saved baseline. */
function serialize(fields: MailFields) {
  return JSON.stringify({ ...fields, password: '', clearPassword: false })
}

/** The request body for the verify, test and save server fns. */
function toDraft(fields: MailFields) {
  return {
    host: fields.host.trim(),
    port: parsePort(fields.port) ?? 0,
    secure: fields.secure,
    username: fields.username.trim() || null,
    password: fields.password || undefined,
    clearPassword: fields.clearPassword || undefined,
    fromAddress: fields.fromAddress.trim(),
    replyTo: fields.replyTo.trim() || null,
  }
}

export function useMailHealth(enabled: boolean) {
  return useQuery({
    queryKey: mailHealthQueryKey,
    queryFn: () => getMailHealthFn(),
    staleTime: 60_000,
    enabled,
  })
}

export function useRecentEmails(failedOnly: boolean) {
  return useQuery({
    queryKey: mailRecentQueryKey(failedOnly),
    queryFn: () =>
      listRecentEmailsFn({
        data: failedOnly ? { status: 'failed' } : undefined,
      }),
  })
}

/**
 * Mail tab state. The form is a draft: verify and test run on it as typed,
 * save persists it. The password is write-only and never seeded back.
 */
export function useMailSettings() {
  const queryClient = useQueryClient()
  const stepUp = useStepUp()
  const query = useQuery({
    queryKey: mailSettingsQueryKey,
    queryFn: () => getMailSettingsFn(),
  })
  const saved = query.data

  const [fields, setFields] = React.useState<MailFields>(emptyFields)
  const [baseline, setBaseline] = React.useState(() => serialize(emptyFields()))
  // Opened by switching "Use environment settings" off, before any save.
  const [formOpen, setFormOpen] = React.useState(false)
  const [verifyResult, setVerifyResult] =
    React.useState<MailVerifyResult | null>(null)
  const [testFailure, setTestFailure] =
    React.useState<MailActionFailure | null>(null)
  // Set when verify failed on save; the dialog offers "Save anyway".
  const [saveFailure, setSaveFailure] =
    React.useState<MailActionFailure | null>(null)

  const seed = React.useCallback(
    (view: { settings: MailSettingsView | null }) => {
      const next = fieldsFromSettings(view.settings)
      setFields(next)
      setBaseline(serialize(next))
    },
    [],
  )

  const seeded = React.useRef(false)
  React.useEffect(() => {
    if (saved && !seeded.current) {
      seeded.current = true
      seed(saved)
    }
  }, [saved, seed])

  const update = React.useCallback((patch: Partial<MailFields>) => {
    setFields((prev) => ({ ...prev, ...patch }))
    setVerifyResult(null)
    setTestFailure(null)
  }, [])

  /** Changing encryption moves a default port along with it. */
  const setSecure = React.useCallback((next: MailSecure) => {
    setFields((prev) => {
      const port = parsePort(prev.port)
      return {
        ...prev,
        secure: next,
        port: port === null ? prev.port : String(portForEncryption(port, next)),
      }
    })
    setVerifyResult(null)
    setTestFailure(null)
  }, [])

  const portValid = parsePort(fields.port) !== null
  const hostValid = fields.host.trim().length > 0
  const fromValid = /^\S+@\S+$/.test(fields.fromAddress.trim())
  const valid = portValid && hostValid && fromValid
  const dirty =
    serialize(fields) !== baseline ||
    fields.password !== '' ||
    fields.clearPassword

  const verify = useMutation({
    mutationFn: () => verifyMailDraftFn({ data: toDraft(fields) }),
    onSuccess: (result) => setVerifyResult(result),
    onError: (err) => toast.error(errorMessage(err)),
  })

  const sendTest = useMutation({
    mutationFn: () => sendTestEmailFn({ data: toDraft(fields) }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['mail-recent'] })
      if (result.ok) {
        setTestFailure(null)
        toast.success(m.agency_mail_test_sent({ email: result.to }))
      } else {
        setTestFailure(result.error)
      }
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const save = useMutation({
    mutationFn: (force: boolean) =>
      stepUp.run(() =>
        saveMailSettingsFn({ data: { ...toDraft(fields), force } }),
      ),
    onSuccess: (result) => {
      if (!result.ok) {
        setSaveFailure(result.error)
        return
      }
      setSaveFailure(null)
      setFormOpen(false)
      seed(result.status)
      setVerifyResult(result.verified ? { ok: true } : null)
      queryClient.setQueryData(mailSettingsQueryKey, result.status)
      void queryClient.invalidateQueries({ queryKey: mailHealthQueryKey })
      toast.success(m.agency_mail_saved())
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const useEnvironment = useMutation({
    mutationFn: () => stepUp.run(() => useEnvironmentMailFn()),
    onSuccess: (status) => {
      setFormOpen(false)
      queryClient.setQueryData(mailSettingsQueryKey, status)
      void queryClient.invalidateQueries({ queryKey: mailHealthQueryKey })
      toast.success(m.agency_mail_env_enabled())
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  /** Using the environment is the source of truth until the form is opened. */
  const usingEnvironment = saved?.source === 'env' && !formOpen

  /** Shows the form, starting from the environment values when those are in use. */
  function openForm() {
    if (saved?.env && saved.source === 'env')
      setFields(fieldsFromEnv(saved.env))
    setFormOpen(true)
  }

  function discard() {
    if (!saved) return
    seed(saved)
    setFormOpen(false)
    setVerifyResult(null)
    setTestFailure(null)
    setSaveFailure(null)
  }

  return {
    query,
    saved,
    usingEnvironment,
    formOpen,
    openForm,
    fields,
    update,
    setSecure,
    portValid,
    fromValid,
    valid,
    dirty,
    verify,
    verifyResult,
    sendTest,
    testFailure,
    save,
    saveFailure,
    clearSaveFailure: () => setSaveFailure(null),
    useEnvironment,
    discard,
  }
}
