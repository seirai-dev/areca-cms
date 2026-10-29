/**
 * React binding for the visual editor, for `@areca-cms/site-sdk/visual-react`.
 *
 * `react` is an optional peer: import this module only in a React site.
 */
import { useEffect, useRef, useState } from 'react'
import type { PreviewResult } from './types.js'
import { createLatestResolver, createVisualBridge, type PreviewUpdateInfo } from './visual.js'

export type LivePreviewOptions<T> = {
  /**
   * The published value, shown until the first update resolves. Keep it referentially
   * stable (for example loader data). A new identity resets the hook to it.
   */
  initial: T
  /** The CMS origin. Nothing happens while it is null or undefined (for example on the server). */
  cmsOrigin: string | null | undefined
  /**
   * Turns a preview result into the value to render. It runs on the client, so it
   * usually calls a server function that runs `content.previewFrom(result)`. A throw
   * or a rejection keeps the last good value.
   */
  resolve: (result: PreviewResult, info: PreviewUpdateInfo) => T | Promise<T>
}

/**
 * The preview value for the page: `initial` until the CMS sends an update, then the
 * newest resolved value. Updates that finish out of order never replace a newer one.
 */
export function useLivePreview<T>({ initial, cmsOrigin, resolve }: LivePreviewOptions<T>): T {
  const [state, setState] = useState<{ base: T; value: T }>({ base: initial, value: initial })
  const initialRef = useRef(initial)
  const resolveRef = useRef(resolve)
  initialRef.current = initial
  resolveRef.current = resolve

  useEffect(() => {
    if (!cmsOrigin || typeof window === 'undefined') return
    let active = true
    const latest = createLatestResolver<T>((value) => {
      setState({ base: initialRef.current, value })
    })
    const bridge = createVisualBridge({
      cmsOrigin,
      onUpdate(result, info) {
        Promise.resolve()
          .then(() => resolveRef.current(result, info))
          .then(
            (value) => {
              if (active) latest.accept(info.seq, value)
            },
            (error: unknown) => {
              console.warn(
                `Live preview: could not resolve update ${info.seq}. Keeping the last good value.`,
                error,
              )
            },
          )
      },
    })
    return () => {
      active = false
      bridge.destroy()
    }
  }, [cmsOrigin])

  return state.base === initial ? state.value : initial
}
