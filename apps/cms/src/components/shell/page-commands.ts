import * as React from 'react'

/**
 * Commands that belong to the page on screen (for example the editor's Visual
 * mode). They show in the ⌘K palette under "This page" while the page that
 * registered them is mounted.
 *
 *   usePageCommand(enabled ? { id, label, icon, onSelect } : null)
 */

export type PageCommand = {
  id: string
  label: string
  /** Extra words the palette matches on, in addition to the label. */
  keywords?: string[]
  icon: React.ReactNode
  onSelect: () => void
}

type Entry = Omit<PageCommand, 'onSelect'> & { run: () => void }

let entries: Entry[] = []
const listeners = new Set<() => void>()

function setEntries(next: Entry[]) {
  entries = next
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot() {
  return entries
}

/** The page commands registered right now, in registration order. */
export function usePageCommands(): Entry[] {
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * Registers `command` while the component is mounted and `command` is not
 * null. The latest `onSelect`, `label` and `icon` are used when it runs.
 */
export function usePageCommand(command: PageCommand | null) {
  const latest = React.useRef(command)
  React.useLayoutEffect(() => {
    latest.current = command
  })

  const enabled = command !== null
  const id = command?.id ?? ''
  const label = command?.label ?? ''
  const keywordKey = (command?.keywords ?? []).join('|')

  React.useEffect(() => {
    if (!enabled) return
    const current = latest.current
    if (!current) return
    const entry: Entry = {
      id,
      label,
      keywords: keywordKey ? keywordKey.split('|') : undefined,
      icon: current.icon,
      run: () => latest.current?.onSelect(),
    }
    setEntries([...entries.filter((item) => item.id !== id), entry])
    return () => {
      setEntries(entries.filter((item) => item.id !== id))
    }
  }, [enabled, id, label, keywordKey])
}
