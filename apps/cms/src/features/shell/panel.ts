import { useNavigate, useSearch } from '@tanstack/react-router'
import { z } from 'zod'

/**
 * Site overlays addressable by search param (brief §2): `?panel=golive` and
 * `?panel=activity` on any `/sites/$siteId/**` route. `release` scrolls the
 * Go‑live panel to one release ("See what happened").
 */
export const SITE_PANELS = ['golive', 'activity'] as const
export type SitePanel = (typeof SITE_PANELS)[number]

export const sitePanelSearchSchema = z.object({
  panel: z.enum(SITE_PANELS).optional().catch(undefined),
  release: z.string().optional().catch(undefined),
})

type PanelSearch = z.infer<typeof sitePanelSearchSchema>

export function usePanel() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false })
  const panel = search.panel

  function open(next: SitePanel, options: { release?: string } = {}) {
    void navigate({
      to: '.',
      search: ((prev: Record<string, unknown>) => ({
        ...prev,
        panel: next,
        release: options.release,
      })) as never,
    })
  }

  function close() {
    void navigate({
      to: '.',
      search: ((prev: Record<string, unknown>) => {
        const { panel: _panel, release: _release, ...rest } = prev
        return rest
      }) as never,
    })
  }

  return { panel, release: search.release, open, close }
}
