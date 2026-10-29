import { createContext, useContext, type ReactNode } from 'react'
import { field, type VisualFieldAttributes } from '@areca-cms/site-sdk/visual'

/** The attributes a marked element gets. Empty when markers are off. */
export type FieldMarker = Partial<VisualFieldAttributes>

/** The SDK's `field` signature: a key, and an optional owner (another entry or a site content section). */
export type FieldFn = (
  key: string,
  owner?: { entry: string } | { global: string },
) => FieldMarker

const noMarkers: FieldFn = () => ({})

const VisualMarkersContext = createContext<FieldFn>(noMarkers)

/**
 * Turns the visual editor's field markers on for everything below it. Off by
 * default, so public pages render no `data-areca-*` attributes. The root layout
 * enables it on the preview route.
 */
export function VisualMarkers({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return (
    <VisualMarkersContext.Provider value={enabled ? field : noMarkers}>
      {children}
    </VisualMarkersContext.Provider>
  )
}

/**
 * The `field` function for the current page. Spread its result on the element
 * that shows the value, or pass it as a `marker` prop. Returns `{}` when markers are off.
 */
export function useField(): FieldFn {
  return useContext(VisualMarkersContext)
}
