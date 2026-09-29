import { useCallback, useSyncExternalStore } from 'react'

/** Shell breakpoints (brief §2.1). */
export const BREAKPOINTS = {
  /** Below this: top bar + bottom tab bar + sheets. */
  mobile: 768,
  /** Below this (and ≥ mobile): the sidebar can collapse to a 64px rail. */
  desktop: 1024,
} as const

/**
 * SSR-safe media query. The server snapshot is `false`, so markup that
 * depends on it should also be correct at the desktop default.
 */
export function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/** Below 768px. */
export function useIsMobile() {
  return useMediaQuery(`(max-width: ${BREAKPOINTS.mobile - 1}px)`)
}

/** 768–1023px: the collapsible-rail range. */
export function useIsTablet() {
  return useMediaQuery(
    `(min-width: ${BREAKPOINTS.mobile}px) and (max-width: ${BREAKPOINTS.desktop - 1}px)`,
  )
}
