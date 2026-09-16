import { useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'

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
import { m } from '#/paraglide/messages'

function typeToConfirmLabel(confirmText: string) {
  const marker = '\uFFFF'
  const [before, after] = m
    .shared_type_to_confirm({ confirmText: marker })
    .split(marker)
  return (
    <>
      {before}
      <span className="font-mono font-semibold">{confirmText}</span>
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
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel = m.shared_confirm(),
  cancelLabel = m.shared_cancel(),
  variant = 'default',
  confirmText,
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
  onConfirm: () => void | Promise<void>
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children?: ReactNode
  testId?: string
}) {
  const [pending, setPending] = useState(false)
  const [typed, setTyped] = useState('')
  const needsTyping = Boolean(confirmText)
  const typedOk = !needsTyping || typed.trim() === confirmText

  async function handleConfirm(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    if (!typedOk) return
    setPending(true)
    try {
      await onConfirm()
    } finally {
      onOpenChange?.(false)
      setPending(false)
      setTyped('')
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setTyped('')
        onOpenChange?.(next)
      }}
    >
      {children ? (
        <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      ) : null}
      <AlertDialogContent data-testid={testId}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        {needsTyping ? (
          <div className="grid gap-2">
            <Label htmlFor="confirm-text">
              {typeToConfirmLabel(confirmText!)}
            </Label>
            <Input
              id="confirm-text"
              autoComplete="off"
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
            variant={variant}
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
