/**
 * What asked for a save (docs/design/rich-text-links.md, decision 21). Only the
 * Save button, ⌘S and Mark ready are explicit: an explicit save compares the
 * headings with the last explicit save, advances that baseline and may open the
 * section link dialog. Every other save (autosave, leaving the editor, a blur or
 * hidden tab, and the other actions) only persists the draft.
 */
export type SaveTrigger =
  'save' | 'mark-ready' | 'action' | 'autosave' | 'background'

export function isExplicitTrigger(trigger: SaveTrigger): boolean {
  return trigger === 'save' || trigger === 'mark-ready'
}
