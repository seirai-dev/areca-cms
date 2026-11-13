import * as React from 'react'
import { AnimatePresence, useReducedMotion } from 'motion/react'
import * as motion from 'motion/react-m'
import { Copy } from '@phosphor-icons/react'
import { toast } from 'sonner'

import { Button } from '#/components/ui/button'
import type { ButtonProps } from '#/components/ui/button'
import { CheckDraw } from '#/components/ui/status-pill'
import { Hint } from '#/components/ui/tooltip'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

/**
 * Copies `value` to the clipboard; the icon morphs into a drawn check for
 * 1.6s. Icon-only by default (with a tooltip); pass `label` for a text
 * button.
 */
export function CopyButton({
  value,
  label,
  copiedLabel,
  toastMessage,
  variant = 'quiet',
  size,
  className,
  ...props
}: Omit<ButtonProps, 'onClick' | 'children' | 'value'> & {
  value: string | (() => string)
  label?: string
  copiedLabel?: string
  /** Also show a toast (for long values like logs). */
  toastMessage?: string
}) {
  const [copied, setCopied] = React.useState(false)
  const reduce = useReducedMotion()
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined)

  React.useEffect(() => () => clearTimeout(timer.current), [])

  async function copy() {
    const text = typeof value === 'function' ? value() : value
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (toastMessage) toast.success(toastMessage)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1600)
    } catch {
      toast.error(m.ui_copy_failed())
    }
  }

  const icon = (
    <span className="relative grid size-4 place-content-center">
      <AnimatePresence initial={false} mode="popLayout">
        {copied ? (
          <motion.span
            key="check"
            className="grid place-content-center text-icon-success"
            initial={reduce ? false : { scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <CheckDraw size={16} circle={false} />
          </motion.span>
        ) : (
          <motion.span
            key="copy"
            className="grid place-content-center"
            initial={reduce ? false : { scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <Copy className="size-4" />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )

  const accessible = copied
    ? (copiedLabel ?? m.ui_copied())
    : (label ?? m.ui_copy())

  if (label) {
    return (
      <Button
        type="button"
        variant={variant}
        size={size ?? 'sm'}
        onClick={copy}
        className={className}
        {...props}
      >
        {icon}
        <span aria-live="polite">{accessible}</span>
      </Button>
    )
  }

  return (
    <Hint label={accessible}>
      <Button
        type="button"
        variant={variant}
        size={size ?? 'icon-sm'}
        onClick={copy}
        aria-label={accessible}
        className={cn(className)}
        {...props}
      >
        {icon}
      </Button>
    </Hint>
  )
}
