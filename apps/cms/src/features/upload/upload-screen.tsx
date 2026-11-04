import * as React from 'react'
import {
  ArrowClockwise,
  CheckCircle,
  FilePdf,
  LinkBreak,
  UploadSimple,
  WarningCircle,
  X,
} from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'
import { AuthError, AuthHeading, AuthShell } from '#/features/auth/auth-shell'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

import {
  fileKind,
  formatBytes,
  namePasted,
  sortIncoming,
  UPLOAD_ACCEPT,
} from './upload-files'
import type { RejectReason, Rejected } from './upload-files'
import { UploadViewer } from './upload-viewer'

export type UploadSessionInfo = {
  state: 'open' | 'finished' | 'expired'
  purpose: string | null
  siteName: string
  expiresAt: string
  maxFiles: number
  uploaded: number
  maxFileBytes: number
} | null

type ItemStatus = 'staged' | 'uploading' | 'done' | 'failed'

export type TrayItem = {
  id: string
  file: File
  kind: 'image' | 'pdf'
  /** Object URL for images; null for PDFs. */
  previewUrl: string | null
  status: ItemStatus
  progress: number
  error?: string
}

type Closed = 'used' | 'expired' | 'invalid'

const PARALLEL_UPLOADS = 3

// Tray ids. Not crypto.randomUUID: it is missing on plain-http origins.
let nextItemId = 0

function rejectText(reason: RejectReason, max: number): string {
  switch (reason) {
    case 'svg':
      return m.upload_reject_svg()
    case 'heic':
      return m.upload_reject_heic()
    case 'type':
      return m.upload_reject_type()
    case 'size':
      return m.upload_reject_size()
    case 'count':
      return m.upload_reject_count({ max: String(max) })
    case 'empty':
      return m.upload_reject_empty()
  }
}

class UploadRequestError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message)
  }
}

/** One file as the raw request body, with progress. XHR because fetch has no upload progress. */
function sendFile(
  token: string,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', `/api/upload/${encodeURIComponent(token)}`)
    xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name))
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
        return
      }
      let code: string | null = null
      let message = m.upload_error_generic()
      try {
        const body = JSON.parse(xhr.responseText) as {
          error?: string
          message?: string
        }
        code = body.error ?? null
        // The server's own text (not translated): still better than a generic line.
        if (body.message) message = body.message as typeof message
      } catch {
        // Not JSON (a proxy error page): keep the generic text.
      }
      reject(new UploadRequestError(message, code))
    }
    xhr.onerror = () =>
      reject(new UploadRequestError(m.upload_error_generic(), null))
    xhr.send(file)
  })
}

function closedFor(code: string | null): Closed | null {
  if (code === 'finished') return 'used'
  if (code === 'expired') return 'expired'
  if (code === 'not_found') return 'invalid'
  return null
}

function minutesLeft(expiresAt: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 60_000))
}

/**
 * `/upload/$token`: files go into a tray first (view, zoom, remove), then one
 * Upload button sends them. When every file is saved the link closes at once.
 */
export function UploadScreen({
  token,
  session,
}: {
  token: string
  session: UploadSessionInfo
}) {
  const initialClosed: Closed | null = !session
    ? 'invalid'
    : session.state === 'finished'
      ? 'used'
      : session.state === 'expired'
        ? 'expired'
        : null
  const [closed, setClosed] = React.useState<Closed | null>(initialClosed)
  const [items, setItems] = React.useState<TrayItem[]>([])
  const [rejected, setRejected] = React.useState<Rejected[]>([])
  const [dragging, setDragging] = React.useState(false)
  const [viewing, setViewing] = React.useState<string | null>(null)
  const [doneCount, setDoneCount] = React.useState<number | null>(null)
  const [now, setNow] = React.useState(() => Date.now())
  const inputRef = React.useRef<HTMLInputElement>(null)
  const itemsRef = React.useRef(items)
  itemsRef.current = items

  const maxFiles = session?.maxFiles ?? 0
  const maxBytes = session?.maxFileBytes ?? 0
  const alreadyUploaded = session?.uploaded ?? 0
  const room = Math.max(0, maxFiles - alreadyUploaded - items.length)
  const busy = items.some((item) => item.status === 'uploading')
  const pending = items.filter(
    (item) => item.status === 'staged' || item.status === 'failed',
  )
  const failed = items.filter((item) => item.status === 'failed')
  const expired = session ? Date.parse(session.expiresAt) <= now : false

  // Revoke object URLs when the page goes away.
  React.useEffect(
    () => () => {
      for (const item of itemsRef.current) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
      }
    },
    [],
  )

  React.useEffect(() => {
    if (closed || doneCount !== null) return
    const timer = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [closed, doneCount])

  // An expired link with nothing in flight: say so instead of failing later.
  React.useEffect(() => {
    if (expired && !busy && !closed && doneCount === null) setClosed('expired')
  }, [expired, busy, closed, doneCount])

  const addFiles = React.useCallback(
    (incoming: File[]) => {
      if (!incoming.length) return
      const { accepted, rejected: refused } = sortIncoming(
        incoming,
        room,
        maxBytes,
      )
      setRejected((current) => [...refused, ...current].slice(0, 20))
      if (!accepted.length) return
      setItems((current) => [
        ...current,
        ...accepted.map((file) => {
          const kind = fileKind(file) ?? 'image'
          return {
            id: `file-${(nextItemId += 1)}`,
            file,
            kind,
            previewUrl: kind === 'image' ? URL.createObjectURL(file) : null,
            status: 'staged' as const,
            progress: 0,
          }
        }),
      ])
    },
    [room, maxBytes],
  )

  // Paste anywhere on the page.
  React.useEffect(() => {
    if (closed || doneCount !== null) return
    const onPaste = (event: ClipboardEvent) => {
      if (itemsRef.current.some((item) => item.status === 'uploading')) return
      const files = Array.from(event.clipboardData?.files ?? [])
      if (!files.length) return
      event.preventDefault()
      addFiles(files.map((file, index) => namePasted(file, index)))
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [addFiles, closed, doneCount])

  const removeItem = (id: string) => {
    setItems((current) => {
      const item = current.find((entry) => entry.id === id)
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl)
      return current.filter((entry) => entry.id !== id)
    })
    setViewing((current) => (current === id ? null : current))
  }

  const patch = (id: string, change: Partial<TrayItem>) =>
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...change } : item)),
    )

  const finish = async (count: number) => {
    try {
      await fetch(`/api/upload/${encodeURIComponent(token)}`, {
        method: 'POST',
      })
    } catch {
      // The files are saved; the link still expires on its own.
    }
    setDoneCount(count)
  }

  /** Sends every staged and failed file, or only `onlyId` (a tile's Retry). */
  const upload = async (onlyId?: string) => {
    const queue = itemsRef.current.filter(
      (item) =>
        (item.status === 'staged' || item.status === 'failed') &&
        (!onlyId || item.id === onlyId),
    )
    const outcome: { stop: Closed | null } = { stop: null }
    const worker = async () => {
      for (;;) {
        const item = queue.shift()
        if (!item || outcome.stop) return
        patch(item.id, { status: 'uploading', progress: 0, error: undefined })
        try {
          await sendFile(token, item.file, (progress) =>
            patch(item.id, { progress }),
          )
          patch(item.id, { status: 'done', progress: 1 })
        } catch (error) {
          const code = error instanceof UploadRequestError ? error.code : null
          const closedNow = closedFor(code)
          if (closedNow) outcome.stop = closedNow
          patch(item.id, {
            status: 'failed',
            progress: 0,
            error:
              error instanceof Error ? error.message : m.upload_error_generic(),
          })
        }
      }
    }
    await Promise.all(Array.from({ length: PARALLEL_UPLOADS }, () => worker()))
    if (outcome.stop) {
      setClosed(outcome.stop)
      return
    }
    // Read the settled state after the last patch has applied.
    await new Promise((resolve) => setTimeout(resolve, 0))
    const settled = itemsRef.current
    const stillPending = settled.some((item) => item.status !== 'done')
    const done = settled.filter((item) => item.status === 'done').length
    if (!stillPending && done > 0) await finish(alreadyUploaded + done)
  }

  if (doneCount !== null && session) {
    return (
      <AuthShell>
        <div className="grid gap-5" data-testid="upload-done">
          <span className="inline-flex size-12 items-center justify-center rounded-full bg-status-success-bg text-icon-success">
            <CheckCircle weight="fill" className="size-6" />
          </span>
          <AuthHeading
            title={m.upload_done_heading()}
            description={m.upload_done_body({
              site: session.siteName,
              count: String(doneCount),
            })}
          />
        </div>
      </AuthShell>
    )
  }

  if (closed || !session) {
    const title =
      closed === 'used'
        ? m.upload_closed_used_heading()
        : closed === 'expired'
          ? m.upload_closed_expired_heading()
          : m.upload_closed_invalid_heading()
    return (
      <AuthShell>
        <div
          className="grid gap-5"
          data-testid={`upload-closed-${closed ?? 'invalid'}`}
        >
          <span className="inline-flex size-12 items-center justify-center rounded-full bg-background-subtle text-icon-muted">
            <LinkBreak className="size-6" />
          </span>
          <AuthHeading title={title} description={m.upload_closed_body()} />
        </div>
      </AuthShell>
    )
  }

  const minutes = minutesLeft(session.expiresAt, now)
  const viewerItems = items.filter((item) => item.kind === 'image')

  return (
    <AuthShell>
      <div className="grid gap-5" data-testid="upload-screen">
        <AuthHeading
          title={m.upload_heading({ site: session.siteName })}
          description={m.upload_description()}
        />

        {session.purpose ? (
          <div className="grid gap-1 rounded-control bg-background-subtle px-3 py-2.5">
            <span className="text-overline text-text-muted">
              {m.upload_purpose_label()}
            </span>
            <p
              className="text-callout text-pretty text-text-primary"
              data-testid="upload-purpose"
            >
              {session.purpose}
            </p>
          </div>
        ) : null}

        <div
          data-testid="upload-dropzone"
          onDragOver={(event) => {
            event.preventDefault()
            if (!busy) setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          // Phones have nothing to drag: a tap anywhere opens the picker.
          onClick={(event) => {
            // The input's own click bubbles here too; do not reopen the picker.
            if (event.target === inputRef.current) return
            if (!busy && room > 0) inputRef.current?.click()
          }}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            if (busy) return
            addFiles(Array.from(event.dataTransfer.files))
          }}
          className={cn(
            'grid cursor-pointer justify-items-center gap-2 rounded-[16px] border border-dashed px-4 py-6 text-center transition-colors',
            dragging
              ? 'border-accent bg-accent-soft'
              : 'border-border-strong bg-background-default',
            (room === 0 || busy) && 'opacity-60',
          )}
        >
          <span className="inline-flex size-10 items-center justify-center rounded-full bg-background-surface text-icon-accent shadow-card">
            <UploadSimple weight="bold" className="size-5" />
          </span>
          <p className="text-headline text-text-primary">
            {m.upload_drop_title()}
          </p>
          <p className="text-callout text-text-secondary">
            {m.upload_drop_hint()}{' '}
            <button
              type="button"
              data-testid="upload-choose"
              disabled={room === 0 || busy}
              onClick={(event) => {
                event.stopPropagation()
                inputRef.current?.click()
              }}
              className="font-medium text-text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:pointer-events-none"
            >
              {m.upload_choose()}
            </button>
          </p>
          <p className="text-caption text-text-muted">
            {m.upload_limits({ count: String(room) })}
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={UPLOAD_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            data-testid="upload-input"
            onChange={(event) => {
              addFiles(Array.from(event.target.files ?? []))
              event.target.value = ''
            }}
          />
        </div>

        {rejected.length ? (
          <div
            role="alert"
            data-testid="upload-rejected"
            className="grid gap-1.5 rounded-control bg-status-warning-bg px-3 py-2.5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-callout font-medium text-text-warning">
                {m.upload_rejected_heading()}
              </span>
              <button
                type="button"
                onClick={() => setRejected([])}
                className="text-caption text-text-secondary underline-offset-4 hover:underline"
              >
                {m.upload_dismiss()}
              </button>
            </div>
            <ul className="grid gap-1">
              {rejected.map((entry, index) => (
                <li
                  key={`${entry.name}-${index}`}
                  className="text-caption text-text-secondary"
                >
                  <span className="font-medium break-all text-text-primary">
                    {entry.name}
                  </span>
                  {' · '}
                  {rejectText(entry.reason, maxFiles)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {items.length ? (
          <div className="grid gap-2">
            <span className="text-caption text-text-muted">
              {m.upload_selected({ count: String(items.length) })}
            </span>
            <ul
              className="grid grid-cols-3 gap-2 sm:grid-cols-4"
              data-testid="upload-tray"
            >
              {items.map((item) => (
                <TrayTile
                  key={item.id}
                  item={item}
                  onView={() => item.kind === 'image' && setViewing(item.id)}
                  onRemove={() => removeItem(item.id)}
                  onRetry={busy ? undefined : () => void upload(item.id)}
                />
              ))}
            </ul>
          </div>
        ) : null}

        {failed.length && !busy ? (
          <AuthError>
            {m.upload_partial_failure({ count: String(failed.length) })}
          </AuthError>
        ) : null}

        <div className="grid gap-2">
          <Button
            variant="accent"
            size="lg"
            data-testid="upload-submit"
            disabled={!pending.length || busy}
            onClick={() => void upload()}
          >
            {busy
              ? m.upload_submitting()
              : failed.length && failed.length === pending.length
                ? m.upload_retry_failed({ count: String(failed.length) })
                : m.upload_submit({ count: String(pending.length) })}
          </Button>
          <p className="text-center text-caption text-text-muted">
            {minutes > 1
              ? m.upload_expires_in({ minutes: String(minutes) })
              : m.upload_expires_soon()}
          </p>
        </div>
      </div>

      <UploadViewer
        items={viewerItems}
        openId={viewing}
        onOpenChange={(id) => setViewing(id)}
        onRemove={(id) => removeItem(id)}
      />
    </AuthShell>
  )
}

function TrayTile({
  item,
  onView,
  onRemove,
  onRetry,
}: {
  item: TrayItem
  onView: () => void
  onRemove: () => void
  /** Undefined while another upload runs. */
  onRetry?: () => void
}) {
  const removable = item.status === 'staged' || item.status === 'failed'
  return (
    <li
      className="group relative aspect-square overflow-hidden rounded-[12px] border border-border-default bg-background-subtle"
      data-testid="upload-tile"
      data-status={item.status}
    >
      {item.kind === 'image' && item.previewUrl ? (
        <button
          type="button"
          onClick={onView}
          aria-label={m.upload_view({ name: item.file.name })}
          className="block size-full cursor-zoom-in focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus"
        >
          <img
            src={item.previewUrl}
            alt=""
            className="size-full object-cover"
            draggable={false}
          />
        </button>
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-1 p-2 text-center">
          <FilePdf className="size-7 text-icon-muted" />
          <span className="line-clamp-2 text-caption break-all text-text-secondary">
            {item.file.name}
          </span>
          <span className="text-caption text-text-muted">
            {formatBytes(item.file.size)}
          </span>
        </div>
      )}

      {removable ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={m.upload_remove({ name: item.file.name })}
          data-testid="upload-remove"
          className="absolute top-1.5 right-1.5 inline-flex size-7 items-center justify-center rounded-full bg-background-inverse/70 text-text-inverse backdrop-blur-sm transition-colors hover:bg-background-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        >
          <X weight="bold" className="size-3.5" />
        </button>
      ) : null}

      {item.status === 'uploading' ? (
        <div className="absolute inset-x-1.5 bottom-1.5 h-1.5 overflow-hidden rounded-full bg-background-inverse/40">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-150"
            style={{ width: `${Math.round(item.progress * 100)}%` }}
            role="progressbar"
            aria-label={m.upload_status_uploading()}
            aria-valuenow={Math.round(item.progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
      ) : null}

      {item.status === 'done' ? (
        <span
          className="absolute right-1.5 bottom-1.5 inline-flex size-6 items-center justify-center rounded-full bg-background-surface text-icon-success shadow-card"
          aria-label={m.upload_status_done()}
          role="img"
        >
          <CheckCircle weight="fill" className="size-5" />
        </span>
      ) : null}

      {item.status === 'failed' ? (
        <div
          className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-status-error-bg/95 px-1.5 py-1 text-caption text-text-error"
          title={item.error}
        >
          <WarningCircle weight="fill" className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {m.upload_status_failed()}
          </span>
          <button
            type="button"
            onClick={onRetry}
            disabled={!onRetry}
            aria-label={`${m.upload_retry()}: ${item.file.name}`}
            data-testid="upload-retry"
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-full hover:bg-status-error/15 focus-visible:outline-2 focus-visible:outline-border-focus disabled:opacity-40"
          >
            <ArrowClockwise weight="bold" className="size-3.5" />
          </button>
        </div>
      ) : null}
    </li>
  )
}
