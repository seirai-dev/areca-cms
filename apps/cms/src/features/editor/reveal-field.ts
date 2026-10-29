import * as React from 'react'

/**
 * "Show this field": sent before the editor scrolls to and focuses a field, so
 * panels that hide it (a collapsed SEO group) can open first. The detail is the
 * field key (`title`, `$seo.faq`).
 */
export const REVEAL_FIELD_EVENT = 'areca:reveal-field'

/** How long a revealed field glows (docs/design/visual-editor.md, Decision 12). */
export const FIELD_PULSE_MS = 1200

export function announceReveal(key: string) {
  window.dispatchEvent(
    new CustomEvent<{ key: string }>(REVEAL_FIELD_EVENT, { detail: { key } }),
  )
}

/** Calls `onReveal(key)` for each reveal request while mounted. */
export function useRevealListener(onReveal: (key: string) => void) {
  const latest = React.useRef(onReveal)
  React.useEffect(() => {
    latest.current = onReveal
  })
  React.useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail
      const key =
        typeof detail === 'object' && detail !== null && 'key' in detail
          ? detail.key
          : undefined
      if (typeof key === 'string') latest.current(key)
    }
    window.addEventListener(REVEAL_FIELD_EVENT, listener)
    return () => window.removeEventListener(REVEAL_FIELD_EVENT, listener)
  }, [])
}

/** Briefly highlights a field wrapper (`[data-field]`). Restarts if already running. */
export function pulseField(node: HTMLElement) {
  node.removeAttribute('data-pulse')
  // Reading layout restarts the CSS animation.
  void node.offsetWidth
  node.setAttribute('data-pulse', '')
  window.setTimeout(() => node.removeAttribute('data-pulse'), FIELD_PULSE_MS)
}
