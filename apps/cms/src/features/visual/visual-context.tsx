import * as React from 'react'

type VisualFullScreen = {
  fullScreen: boolean
  setFullScreen: (value: boolean) => void
  /** For the keyboard shortcut (mod+Shift+Enter) and the menus. */
  toggleFullScreen: () => void
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
  const [fullScreen, setFullScreen] = React.useState(false)

  const toggleFullScreen = React.useCallback(
    () => setFullScreen((value) => !value),
    [],
  )

  React.useEffect(() => {
    if (!active) setFullScreen(false)
  }, [active])

  React.useEffect(() => {
    if (!fullScreen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      setFullScreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullScreen])

  const value = React.useMemo(
    () => ({ fullScreen, setFullScreen, toggleFullScreen }),
    [fullScreen, toggleFullScreen],
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
