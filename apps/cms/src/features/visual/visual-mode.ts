import * as React from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'

import { useMediaQuery } from '#/hooks/use-mobile'

import type { EditorMode } from './visual-preferences'
import { useVisualPreferences } from './visual-preferences'
import { VISUAL_AVAILABLE_QUERY } from './visual-layout'

/**
 * The signed preview URL is refetched this often while Visual mode is open.
 * Tokens last an hour, so 50 minutes never leaves a dead one behind.
 */
export const VISUAL_TOKEN_REFRESH_MS = 50 * 60 * 1000

/** The two entry editor routes (see editor-host.tsx). */
const EDITOR_ROUTE_IDS = [
  '/_app/sites/$siteId/c/$collectionKey/new',
  '/_app/sites/$siteId/c/$collectionKey/$entryId',
]

/**
 * Whether a new visit should open in Visual mode: the URL says nothing, the
 * last mode was visual, the viewport allows it, and the caller wants it (new
 * entries do not, since there is no preview before the first save).
 */
export function shouldEnterVisualOnMount({
  hasViewParam,
  lastMode,
  available,
  autoEnter,
}: {
  hasViewParam: boolean
  lastMode: EditorMode | null
  available: boolean
  autoEnter: boolean
}): boolean {
  return autoEnter && !hasViewParam && lastMode === 'visual' && available
}

/** The raw `view` value from the URL, read from the location. */
function useViewParam(): unknown {
  return useRouterState({
    select: (state) => (state.location.search as { view?: unknown }).view,
  })
}

/**
 * Whether the current page is an entry editor asked to show Visual mode,
 * ignoring the viewport. The app shell reads this to go full-bleed.
 */
function useEditorRouteRequestsVisual(): boolean {
  return useRouterState({
    select: (state) =>
      state.matches.some((match) => EDITOR_ROUTE_IDS.includes(match.routeId)) &&
      (state.location.search as { view?: unknown }).view === 'visual',
  })
}

/**
 * True when the editor shows Visual mode: a viewport of at least 1280 px and
 * `?view=visual` on an entry editor. Below 1280 the URL is kept but Write
 * mode renders.
 */
export function useVisualModeActive(): boolean {
  const available = useMediaQuery(VISUAL_AVAILABLE_QUERY)
  const requested = useEditorRouteRequestsVisual()
  return available && requested
}

/**
 * Editor mode for the entry editor (docs/design/visual-editor.md, Decision 8).
 *
 * - `available`: the viewport allows Visual mode (>= 1280 px).
 * - `active`: available and `?view=visual` is in the URL.
 * - `setMode` writes the URL (replace, other params kept) and remembers the
 *   choice per browser. Visual is ignored when not available.
 * - On the first mount, with no `view` param, a remembered visual mode is
 *   applied. Pass `autoEnter: false` where there is no preview yet.
 */
export function useVisualMode({
  autoEnter = true,
}: { autoEnter?: boolean } = {}) {
  const navigate = useNavigate()
  const available = useMediaQuery(VISUAL_AVAILABLE_QUERY)
  const viewParam = useViewParam()
  const requested = viewParam === 'visual'
  const prefs = useVisualPreferences()
  const active = available && requested

  const applyMode = React.useCallback(
    (mode: EditorMode) => {
      void navigate({
        to: '.',
        search: (prev) => ({
          ...prev,
          view: mode === 'visual' ? 'visual' : undefined,
        }),
        replace: true,
        resetScroll: false,
        viewTransition: false,
      })
    },
    [navigate],
  )

  const setMode = React.useCallback(
    (mode: EditorMode) => {
      if (mode === 'visual' && !available) return
      prefs.setLastMode(mode)
      applyMode(mode)
    },
    [available, applyMode, prefs],
  )

  // Runs once per mount. The ref keeps React's double effect run in dev from
  // applying the mode twice.
  const entered = React.useRef(false)
  const hasViewParam = viewParam !== undefined
  const lastMode = prefs.lastMode
  React.useEffect(() => {
    if (entered.current) return
    entered.current = true
    if (
      shouldEnterVisualOnMount({
        hasViewParam,
        lastMode,
        available,
        autoEnter,
      })
    ) {
      applyMode('visual')
    }
    // Mount-only: later changes come from the user through setMode.
  }, [])

  return {
    available,
    active,
    setMode,
    toggleMode: () => setMode(active ? 'write' : 'visual'),
  }
}
