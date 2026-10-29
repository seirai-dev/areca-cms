import { Browsers, CornersOut } from '@phosphor-icons/react'

import { useShortcut } from '#/components/shell/shortcuts'
import { usePageCommand } from '#/components/shell/page-commands'
import { m } from '#/paraglide/messages'

import { useVisualFullScreen } from './visual-context'
import type { useVisualMode } from './visual-mode'

type VisualMode = ReturnType<typeof useVisualMode>

/**
 * The keyboard shortcuts and ⌘K commands for Visual mode (docs/design/
 * visual-editor.md, Decision 19). Renders nothing. Must sit inside
 * `VisualFullScreenProvider`.
 *
 * - mod+Shift+E toggles Write and Visual, when Visual is available.
 * - mod+Shift+Enter toggles full screen, in Visual mode only.
 */
export function VisualShortcuts({
  mode,
  canVisual,
}: {
  mode: VisualMode
  /** False until the entry has a preview URL (Tier 0). */
  canVisual: boolean
}) {
  const { fullScreen, toggleFullScreen } = useVisualFullScreen()
  const modeAvailable = mode.available && canVisual

  useShortcut('mod+shift+e', () => mode.toggleMode(), {
    enabled: modeAvailable,
  })
  useShortcut('mod+shift+enter', toggleFullScreen, { enabled: mode.active })

  usePageCommand(
    modeAvailable
      ? {
          id: 'visual-mode',
          label: mode.active
            ? m.visual_command_back()
            : m.visual_command_open(),
          keywords: ['visual', 'preview', 'write', 'writing'],
          icon: <Browsers />,
          onSelect: () => mode.toggleMode(),
        }
      : null,
  )
  usePageCommand(
    mode.active
      ? {
          id: 'visual-fullscreen',
          label: fullScreen
            ? m.visual_exit_fullscreen()
            : m.visual_command_fullscreen(),
          keywords: ['full screen', 'fullscreen', 'preview', 'visual'],
          icon: <CornersOut />,
          onSelect: () => toggleFullScreen(),
        }
      : null,
  )

  return null
}
