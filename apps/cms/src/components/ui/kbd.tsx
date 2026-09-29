import * as React from 'react'

import { cn } from '#/lib/utils'

/** A key cap: "⌘", "K", "G". Pass several children for a combo. */
export function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-border-default bg-background-surface px-1 font-sans text-[11px] leading-none font-medium text-text-muted shadow-[0_1px_0_var(--color-border-default)]',
        className,
      )}
      {...props}
    />
  )
}

/** A run of keys: <KbdCombo keys={['⌘', 'K']} />. */
export function KbdCombo({
  keys,
  className,
}: {
  keys: readonly string[]
  className?: string
}) {
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)}>
      {keys.map((key, index) => (
        <Kbd key={`${key}-${index}`}>{key}</Kbd>
      ))}
    </span>
  )
}

/** "⌘" on Apple platforms, "Ctrl" elsewhere. Resolved after mount (SSR-safe). */
export function useModifierKey() {
  const [modifier, setModifier] = React.useState('Ctrl')
  React.useEffect(() => {
    if (/Mac|iPhone|iPad/.test(navigator.platform)) setModifier('⌘')
  }, [])
  return modifier
}
