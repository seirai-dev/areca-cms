/**
 * The entry editor's code (Tiptap and the rest) is its own chunk, so the
 * collection list does not download it. Links into the editor call this on
 * hover and focus to fetch it before the click.
 */
export function loadEditorScreen() {
  return import('./editor-screen')
}

/** Starts the editor download; the editor itself reports a failure. */
export function preloadEditorScreen() {
  loadEditorScreen().catch(() => {})
}
