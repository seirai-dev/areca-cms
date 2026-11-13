import { useId, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '#/components/ui/alert-dialog'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { errorMessage } from '#/lib/errors'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

function typeToConfirmLabel(confirmText: string) {
  const marker = '￿'
  const [before, after] = m
    .shared_type_to_confirm({ confirmText: marker })
    .split(marker)
  return (
    <>
      {before}
      <span className="rounded-[5px] bg-background-subtle px-1 font-mono text-[12.5px] font-medium text-text-primary">
        {confirmText}
      </span>
      {after}
    </>
  )
}

/**
 * Shared confirmation dialog.
 *
 * - `variant="destructive"` styles the confirm button red.
 * - `confirmText` requires the user to type that exact value before the
 *   confirm button enables (use for irreversible deletes).
 * - Works either with a trigger (`children`) or controlled via `open`.
 * - A rejected `onConfirm` shows its message as an error toast; the dialog
 *   closes either way. Catch inside `onConfirm` to handle an error otherwise.
 * - Test ids: `confirm-text` (the type-to-confirm input), `confirm-action`.
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel = m.shared_confirm(),
  cancelLabel = m.shared_cancel(),
  variant = 'default',
  confirmText,
  confirmPrompt,
  align = 'center',
  onConfirm,
  open,
  onOpenChange,
  children,
  testId,
}: {
  title: string
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'default' | 'destructive'
  confirmText?: string
  /**
   * Replaces the "Type … to confirm" sentence. The value to type then sits on
   * its own line in a monospace chip that wraps (for e-mail addresses).
   */
  confirmPrompt?: string
  /** `start` keeps the title and body left-aligned on every screen size. */
  align?: 'center' | 'start'
  onConfirm: () => void | Promise<void>
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children?: ReactNode
  testId?: string
}) {
  const inputId = useId()
  const [pending, setPending] = useState(false)
  const [typed, setTyped] = useState('')
  const [internalOpen, setInternalOpen] = useState(false)
  const resolvedOpen = open ?? internalOpen
  const needsTyping = Boolean(confirmText)
  const typedOk = !needsTyping || typed.trim() === confirmText

  async function handleConfirm(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    if (!typedOk) return
    setPending(true)
    try {
      await onConfirm()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setInternalOpen(false)
      onOpenChange?.(false)
      setPending(false)
      setTyped('')
    }
  }

  return (
    <AlertDialog
      open={resolvedOpen}
      onOpenChange={(next) => {
        if (!next) setTyped('')
        setInternalOpen(next)
        onOpenChange?.(next)
      }}
    >
      {children ? (
        <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      ) : null}
      <AlertDialogContent data-testid={testId}>
        <AlertDialogHeader
          className={cn(align === 'start' && 'place-items-start text-left')}
        >
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? (
            typeof description === 'string' ? (
              <AlertDialogDescription>{description}</AlertDialogDescription>
            ) : (
              // Rich content (lists) cannot sit inside the <p> the description renders.
              <AlertDialogDescription asChild>
                <div>{description}</div>
              </AlertDialogDescription>
            )
          ) : null}
        </AlertDialogHeader>
        {needsTyping ? (
          <div className="grid gap-2">
            <Label
              htmlFor={inputId}
              className="block font-normal text-text-secondary"
            >
              {confirmPrompt ?? typeToConfirmLabel(confirmText!)}
            </Label>
            {confirmPrompt ? (
              <span
                className="block w-fit max-w-full rounded-[5px] bg-background-subtle px-1.5 py-0.5 font-mono text-[12.5px] leading-5 font-medium break-all text-text-primary"
                data-testid="confirm-expected"
              >
                {confirmText}
              </span>
            ) : null}
            <Input
              id={inputId}
              autoComplete="off"
              spellCheck={false}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              data-testid="confirm-text"
            />
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            variant={variant === 'destructive' ? 'destructive' : 'primary'}
            disabled={pending || !typedOk}
            onClick={handleConfirm}
            data-testid="confirm-action"
          >
            {pending ? m.shared_working() : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
