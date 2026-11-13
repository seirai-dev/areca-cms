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

/** Key captions for a platform string (`navigator.platform`). */
export function modifierLabels(platform: string) {
  const apple = /Mac|iPhone|iPad/.test(platform)
  return {
    mod: apple ? '⌘' : 'Ctrl',
    shift: apple ? '⇧' : 'Shift',
    alt: apple ? '⌥' : 'Alt',
  }
}

/**
 * A shortcut written with Apple glyphs ("⌘⌥2"), as the platform shows it:
 * unchanged on Apple platforms, "Ctrl+Alt+2" elsewhere.
 */
export function shortcutLabel(shortcut: string, platform: string) {
  if (/Mac|iPhone|iPad/.test(platform)) return shortcut
  const { mod, shift, alt } = modifierLabels(platform)
  return shortcut
    .replace(/⌘/g, `${mod}+`)
    .replace(/⌥/g, `${alt}+`)
    .replace(/⇧/g, `${shift}+`)
}

/** `navigator.platform`, read after mount (SSR-safe); empty before. */
function usePlatform() {
  const [platform, setPlatform] = React.useState('')
  React.useEffect(() => {
    setPlatform(navigator.platform)
  }, [])
  return platform
}

/**
 * "⌘" and "⇧" on Apple platforms, "Ctrl" and "Shift" elsewhere. Resolved
 * after mount (SSR-safe), so the first render shows the non-Apple captions.
 */
export function useModifierKeys() {
  const platform = usePlatform()
  return React.useMemo(() => modifierLabels(platform), [platform])
}

/** `shortcutLabel` for this platform, resolved after mount (SSR-safe). */
export function useShortcutLabel() {
  const platform = usePlatform()
  return React.useCallback(
    (shortcut: string) => shortcutLabel(shortcut, platform),
    [platform],
  )
}

/** "⌘" on Apple platforms, "Ctrl" elsewhere. Resolved after mount (SSR-safe). */
export function useModifierKey() {
  return useModifierKeys().mod
}
