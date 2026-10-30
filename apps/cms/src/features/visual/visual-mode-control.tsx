import * as React from 'react'
import { Browsers, PencilSimpleLine } from '@phosphor-icons/react'

import { KbdCombo, useModifierKeys } from '#/components/ui/kbd'
import { Hint } from '#/components/ui/tooltip'
import { SegmentedControl } from '#/components/ui/segmented-control'
import type { SegmentedOption } from '#/components/ui/segmented-control'
import { m } from '#/paraglide/messages'

import type { EditorMode } from './visual-preferences'
import { useVisualSeen } from './visual-preferences'

/**
 * The `Write | Visual` switch in the editor top bar. Visual is disabled with
 * the reason when no preview can be built yet (Tier 0). The caller renders
 * this only where Visual mode is available (1280 px and up). Until the user
 * has entered Visual once, its segment carries a "New" dot.
 */
export function VisualModeControl({
  active,
  canVisual,
  disabledReason,
  onSetMode,
}: {
  active: boolean
  /** False when there is no preview URL yet. */
  canVisual: boolean
  /** Shown on hover while Visual is disabled. */
  disabledReason: string | null
  onSetMode: (mode: EditorMode) => void
}) {
  const keys = useModifierKeys()
  const { seen, markSeen } = useVisualSeen()
  React.useEffect(() => {
    if (active) markSeen()
  }, [active, markSeen])

  const newDot = seen ? null : (
    <span
      data-testid="visual-new-dot"
      className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-accent ring-2 ring-segment-track"
    >
      <span className="sr-only">{m.visual_new_label()}</span>
    </span>
  )

  const options: SegmentedOption<EditorMode>[] = [
    {
      value: 'write',
      label: m.visual_mode_write(),
      icon: <PencilSimpleLine />,
      testId: 'editor-mode-write',
    },
    {
      value: 'visual',
      label: m.visual_mode_visual(),
      icon: (
        <span className="relative inline-flex">
          <Browsers />
          {newDot}
        </span>
      ),
      disabled: !canVisual,
      testId: 'editor-mode-visual',
      hint: canVisual ? (
        <span className="inline-flex items-center gap-2">
          {m.shell_shortcut_visual()}
          <KbdCombo keys={[keys.mod, keys.shift, 'E']} />
        </span>
      ) : undefined,
    },
  ]

  const control = (
    <SegmentedControl<EditorMode>
      size="sm"
      value={active ? 'visual' : 'write'}
      onValueChange={onSetMode}
      options={options}
      aria-label={m.visual_mode_group()}
      data-testid="editor-mode"
    />
  )

  if (canVisual || !disabledReason) return control
  // A disabled button does not fire pointer events, so the hint wraps the
  // control instead (in a focusable span, as the other disabled hints do).
  return (
    <Hint label={disabledReason} wrapDisabled>
      <span className="inline-flex shrink-0">{control}</span>
    </Hint>
  )
}
