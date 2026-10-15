import * as React from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'

import type { SiteLanguages } from '#/lib/types'

import { editorLanguages } from './language-state'

/** Last language chosen per site, so the editor reopens in it. */
export const LANGUAGE_STORAGE_PREFIX = 'areca.editor.lang.'

/**
 * The language to show: the `?lang=` value when it is one of the site's
 * languages, else the remembered choice when that is still valid, else main.
 */
export function resolveLanguage({
  requested,
  remembered,
  main,
  all,
}: {
  requested?: string | null
  remembered?: string | null
  main: string
  all: string[]
}): string {
  if (requested && all.includes(requested)) return requested
  if (remembered && all.includes(remembered)) return remembered
  return main
}

/** The language one step away in site order, wrapping at the ends. */
export function stepLanguage(all: string[], current: string, delta: number) {
  if (all.length === 0) return current
  const index = all.indexOf(current)
  const from = index === -1 ? 0 : index
  return all[(from + delta + all.length) % all.length] ?? current
}

type ShortcutEvent = Pick<
  KeyboardEvent,
  'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'code'
>

/**
 * The editor's language shortcuts: Ctrl+Shift+L goes to the next language,
 * Ctrl+Shift+Alt+L to the previous one. Ctrl on every OS (not Cmd). Matched by
 * key code, so the letter is the same on any keyboard layout.
 */
export function isLanguageShortcut(event: ShortcutEvent): -1 | 1 | null {
  if (!event.ctrlKey || !event.shiftKey || event.metaKey) return null
  if (event.code !== 'KeyL') return null
  return event.altKey ? -1 : 1
}

function readRemembered(siteId: string): string | null {
  try {
    return localStorage.getItem(`${LANGUAGE_STORAGE_PREFIX}${siteId}`)
  } catch {
    return null
  }
}

function rememberLanguage(siteId: string, code: string) {
  try {
    localStorage.setItem(`${LANGUAGE_STORAGE_PREFIX}${siteId}`, code)
  } catch {
    /* localStorage unavailable: the URL still carries the choice */
  }
}

/**
 * Active content language for an entry or section editor. `?lang=` is the
 * source of truth while present (validated by the route); the choice is
 * remembered per site. `languages` is null for single-language sites, and
 * then nothing here changes the editor.
 */
export function useContentLanguage({
  siteId,
  languages,
}: {
  siteId: string
  languages: SiteLanguages | null | undefined
}) {
  const navigate = useNavigate()
  const requested = useSearch({
    strict: false,
    select: (search) => (search as { lang?: string | undefined }).lang ?? null,
  })
  const languageKey = languages ? JSON.stringify(languages) : ''
  const config = React.useMemo(
    () => (languageKey ? editorLanguages(JSON.parse(languageKey)) : null),
    [languageKey],
  )
  const main = config?.main ?? ''
  const all = config?.all ?? []
  const remembered = config ? readRemembered(siteId) : null
  const active = config
    ? resolveLanguage({ requested, remembered, main, all })
    : null

  const setActive = React.useCallback(
    (code: string) => {
      if (!all.includes(code)) return
      rememberLanguage(siteId, code)
      void navigate({
        to: '.',
        search: (prev) => ({ ...prev, lang: code }),
        replace: true,
        resetScroll: false,
        viewTransition: false,
      })
    },
    [all, navigate, siteId],
  )

  // Ctrl+Shift+L (and +Alt for previous) switches language anywhere in the editor. The key code is
  // used because Option changes the typed character on macOS.
  const activeRef = React.useRef(active)
  activeRef.current = active
  React.useEffect(() => {
    if (!config) return
    const onKey = (event: KeyboardEvent) => {
      const step = isLanguageShortcut(event)
      if (step === null || !activeRef.current) return
      event.preventDefault()
      setActive(stepLanguage(all, activeRef.current, step))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [config, setActive, all])

  return {
    /** Null for single-language sites. */
    languages: config,
    active,
    main,
    isMain: active !== null && active === main,
    setActive,
  }
}
