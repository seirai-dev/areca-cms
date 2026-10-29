import * as React from 'react'

type VisualFullScreen = {
  fullScreen: boolean
  setFullScreen: (value: boolean) => void
  /** For the keyboard shortcut (mod+Shift+Enter) and the menus. */
  toggleFullScreen: () => void
  /**
   * True after a click in the full-screen preview left full screen to open a
   * field: the toolbar offers "Back to full preview" (Decision 13).
   */
  canReturn: boolean
  /** A click in the preview selected something. Leaves full screen if needed. */
  onPreviewSelection: () => void
}

const VisualFullScreenContext = React.createContext<VisualFullScreen | null>(
  null,
)

/**
 * Holds the preview's full-screen state for the entry editor. It lives above
 * the layout so the shortcut can toggle it, and the state resets when Visual
 * mode is left. Esc exits full screen unless something else already handled
 * it (`defaultPrevented`, for example an open popover).
 */
export function VisualFullScreenProvider({
  active,
  children,
}: {
  active: boolean
  children: React.ReactNode
}) {
  const [fullScreen, setFullScreenState] = React.useState(false)
  const [canReturn, setCanReturn] = React.useState(false)
  const fullRef = React.useRef(fullScreen)
  fullRef.current = fullScreen

  // Any explicit change (button, Esc, shortcut, the pill) ends the offer to return.
  const setFullScreen = React.useCallback((value: boolean) => {
    setCanReturn(false)
    setFullScreenState(value)
  }, [])

  const toggleFullScreen = React.useCallback(() => {
    setCanReturn(false)
    setFullScreenState((value) => !value)
  }, [])

  // Never re-enters full screen by itself: only the pill or the shortcut do.
  const onPreviewSelection = React.useCallback(() => {
    const wasFull = fullRef.current
    setCanReturn(wasFull)
    if (wasFull) setFullScreenState(false)
  }, [])

  React.useEffect(() => {
    if (!active) setFullScreen(false)
  }, [active, setFullScreen])

  React.useEffect(() => {
    if (!fullScreen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      setFullScreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullScreen, setFullScreen])

  const value = React.useMemo(
    () => ({
      fullScreen,
      setFullScreen,
      toggleFullScreen,
      canReturn,
      onPreviewSelection,
    }),
    [
      fullScreen,
      setFullScreen,
      toggleFullScreen,
      canReturn,
      onPreviewSelection,
    ],
  )

  return (
    <VisualFullScreenContext.Provider value={value}>
      {children}
    </VisualFullScreenContext.Provider>
  )
}

export function useVisualFullScreen(): VisualFullScreen {
  const value = React.useContext(VisualFullScreenContext)
  if (!value) {
    throw new Error(
      'useVisualFullScreen must be used inside VisualFullScreenProvider',
    )
  }
  return value
}
