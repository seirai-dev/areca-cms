import * as React from 'react'

/**
 * The single keyboard-shortcut registry (brief §3.12). One `keydown`
 * listener, installed by `<ShortcutsProvider>`, dispatches to whatever is
 * registered with `useShortcut`. Plain keys and `g x` sequences are ignored
 * while typing (inputs, textareas, selects, contentEditable); `mod` combos
 * (⌘/Ctrl) fire everywhere.
 *
 *   useShortcut('mod+k', () => setOpen(true))
 *   useShortcut('g o', () => navigate(...))
 *   useShortcut('n', newEntry, { enabled: inCollection })
 *   useShortcut('/', focusSearch)
 */

type Handler = (event: KeyboardEvent) => void
type Entry = { combo: string; handler: React.RefObject<Handler>; id: number }

const RegistryContext = React.createContext<{
  add: (entry: Entry) => void
  remove: (id: number) => void
} | null>(null)

let nextId = 0

export function isTypingTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null
  if (!element || typeof element.tagName !== 'string') return false
  if (element.isContentEditable) return true
  const tag = element.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') {
    const type = (element as HTMLInputElement).type
    return ![
      'checkbox',
      'radio',
      'button',
      'submit',
      'reset',
      'range',
      'color',
    ].includes(type)
  }
  return Boolean(
    element.closest('[contenteditable="true"], [role="textbox"]'),
  )
}

function normalize(combo: string) {
  return combo.trim().toLowerCase().replace(/\s+/g, ' ')
}

function eventKey(event: KeyboardEvent) {
  const key = event.key.toLowerCase()
  return key === ' ' ? 'space' : key
}

export function ShortcutsProvider({ children }: { children: React.ReactNode }) {
  const entries = React.useRef<Entry[]>([])
  const pendingG = React.useRef<number | null>(null)

  const value = React.useMemo(
    () => ({
      add: (entry: Entry) => {
        entries.current = [...entries.current, entry]
      },
      remove: (id: number) => {
        entries.current = entries.current.filter((entry) => entry.id !== id)
      },
    }),
    [],
  )

  React.useEffect(() => {
    function run(combo: string, event: KeyboardEvent) {
      // Most recently registered wins (a page can override a shell default).
      for (let i = entries.current.length - 1; i >= 0; i--) {
        const entry = entries.current[i]
        if (entry.combo === combo) {
          event.preventDefault()
          entry.handler.current(event)
          return true
        }
      }
      return false
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return
      const key = eventKey(event)
      const mod = event.metaKey || event.ctrlKey

      if (mod && !event.altKey) {
        run(`mod+${event.shiftKey ? 'shift+' : ''}${key}`, event)
        return
      }
      if (event.altKey) return
      if (isTypingTarget(event.target)) return

      if (pendingG.current !== null) {
        window.clearTimeout(pendingG.current)
        pendingG.current = null
        if (run(`g ${key}`, event)) return
      }
      if (key === 'g' && !event.shiftKey) {
        pendingG.current = window.setTimeout(() => {
          pendingG.current = null
        }, 1200)
        return
      }
      run(key, event)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (pendingG.current !== null) window.clearTimeout(pendingG.current)
    }
  }, [])

  return (
    <RegistryContext.Provider value={value}>{children}</RegistryContext.Provider>
  )
}

export function useShortcut(
  combo: string,
  handler: Handler,
  options: { enabled?: boolean } = {},
) {
  const registry = React.useContext(RegistryContext)
  const handlerRef = React.useRef<Handler>(handler)
  React.useLayoutEffect(() => {
    handlerRef.current = handler
  })
  const enabled = options.enabled ?? true
  const normalized = normalize(combo)

  React.useEffect(() => {
    if (!registry || !enabled) return
    const id = ++nextId
    registry.add({ combo: normalized, handler: handlerRef, id })
    return () => registry.remove(id)
  }, [registry, enabled, normalized])
}

/** Focus the page's search field (anything marked `data-shortcut-search`). */
export function focusPageSearch() {
  const target = document.querySelector<HTMLElement>('[data-shortcut-search]')
  if (!target) return false
  target.focus()
  if (target instanceof HTMLInputElement) target.select()
  return true
}

/** Event the editor listens for to toggle its details panel (⌘.). */
export const TOGGLE_DETAILS_EVENT = 'areca:toggle-details'

/** The shortcuts listed in the account menu dialog (brief §3.12). */
export const SHORTCUT_LIST = [
  { keys: ['mod', 'K'], id: 'palette' },
  { keys: ['G', 'O'], id: 'overview' },
  { keys: ['G', 'L'], id: 'library' },
  { keys: ['G', 'P'], id: 'people' },
  { keys: ['G', 'S'], id: 'switch' },
  { keys: ['N'], id: 'new' },
  { keys: ['/'], id: 'search' },
  { keys: ['mod', 'S'], id: 'save' },
  { keys: ['mod', '.'], id: 'details' },
] as const
