import { useNavigate, useSearch } from '@tanstack/react-router'
import { optionalParam, z } from '#/lib/search-params'

/**
 * Site overlays addressable by search param (brief §2): `?panel=golive` and
 * `?panel=activity` on any `/sites/$siteId/**` route. `release` scrolls the
 * Go‑live panel to one release ("See what happened").
 */
const SITE_PANELS = ['golive', 'activity'] as const
export type SitePanel = (typeof SITE_PANELS)[number]

export const sitePanelSearchSchema = z.object({
  panel: optionalParam(z.enum(SITE_PANELS)),
  release: optionalParam(z.string()),
})

export function usePanel() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false })
  const panel = search.panel

  function open(next: SitePanel, options: { release?: string } = {}) {
    void navigate({
      to: '.',
      search: (prev) => ({ ...prev, panel: next, release: options.release }),
    })
  }

  function close() {
    void navigate({
      to: '.',
      search: (prev) => ({ ...prev, panel: undefined, release: undefined }),
    })
  }

  return { panel, release: search.release, open, close }
}
