import * as React from 'react'
import { useQuery } from '@tanstack/react-query'

import { useShortcut } from '#/components/shell/shortcuts'
import { useCopyEntryAction } from '#/features/dev-env/use-copy-to-production'
import type { CopyDestination } from '#/features/dev-env/use-copy-to-production'
import { baseLocale, readLocale, SLUG_KEY } from '#/lib/content-locale'
import { aiAvailabilityQuery } from '#/lib/content/queries'
import { isDevSite } from '#/lib/site-environment'
import { uiLanguageName } from '#/lib/site-languages'
import type { MeSite } from '#/lib/site-nav'
import type { Field } from '#/lib/types'
import { m } from '#/paraglide/messages'

import { conflictReadyBlock } from './conflict-notice'
import {
  blockersFor,
  fieldLabels,
  localeContext,
  localeSummaries,
  requiredLocales,
} from './language-state'
import type { LocaleBlocker } from './language-state'
import type { LocaleFields } from './locale-fields'
import { useAiTranslation } from './use-ai-translation'
import { useContentLanguage } from './use-content-language'
import type { EntryEditorState } from './use-entry-editor'

/** Why ready and schedule are blocked, and the fix (switch language, reload). */
export type ReadyBlock = { message: string; onFix: () => void }

/**
 * What the entry and section editors wire the same way on top of
 * `useEntryEditor`: content languages (the active language's view of the
 * draft and how a field change writes it), AI translation, the ready blocker,
 * copy to production, and ⌘S.
 */
export function useEditorSession({
  editor,
  site,
  fields,
  requiredLanguages,
  seoEnabled,
  translatedSlug = false,
  copyDestination,
  reveal,
}: {
  editor: EntryEditorState
  site: MeSite
  fields: Field[]
  /** Languages besides main that must be complete before going live. */
  requiredLanguages: string[]
  seoEnabled: boolean
  /** On a translation the slug field edits that language's own `$slug`. */
  translatedSlug?: boolean
  copyDestination: CopyDestination
  /** Scrolls to and focuses a field. */
  reveal: (key: string) => void
}) {
  const siteId = site.id
  const { data, slugField } = editor

  // Content languages (multilingual sites only; null otherwise). The editor
  // keeps the full entry in `data`; the fields show one language of it.
  const lang = useContentLanguage({ siteId, languages: site.languages })
  const active = lang.active
  const ctx = React.useMemo(
    () => (lang.languages ? localeContext(lang.languages, fields) : null),
    [lang.languages, fields],
  )
  const requiredKey = requiredLanguages.join('|')
  const required = lang.languages
    ? requiredLocales(lang.languages, requiredLanguages)
    : []
  const summaries = React.useMemo(
    () => (ctx ? localeSummaries(data, ctx, required) : []),
    // `requiredKey` stands in for the contents of `required`.
    [data, ctx, requiredKey],
  )
  const view = React.useMemo(
    () => (ctx && active ? readLocale(data, active, ctx) : data),
    [data, ctx, active],
  )
  const mainView = React.useMemo(
    () => (ctx ? readLocale(data, lang.main, ctx) : data),
    [data, ctx, lang.main],
  )

  const aiQuery = useQuery(aiAvailabilityQuery())
  const aiEnabled = aiQuery.data?.enabled === true
  // AI translation needs AI set up and a saved entry (the server reads it).
  const translateEnabled = aiEnabled && Boolean(editor.entryId)
  const translate = useAiTranslation({
    siteId,
    entryId: editor.entryId ?? '',
    fields,
    main: lang.main,
    active: active ?? lang.main,
    source: mainView,
    target: view,
    seoEnabled,
    applyPatch: (patch) => {
      if (ctx && active) editor.updateLocaleFields(patch, active, ctx)
    },
    save: editor.save,
  })

  const localeFields: LocaleFields | null =
    ctx && active
      ? {
          active,
          main: lang.main,
          mainName: uiLanguageName(lang.main),
          mainView,
          isMain: lang.isMain,
          onTranslateField: translateEnabled ? translate.translateField : null,
          translatingKey:
            translate.pendingScope === 'language'
              ? null
              : translate.pendingScope,
        }
      : null

  // A required language that blocks ready: switch to it and reveal the first
  // missing field.
  const blockers: LocaleBlocker[] = ctx ? blockersFor(data, ctx, required) : []
  const blocker = editor.serverBlockers.at(0) ?? blockers.at(0) ?? null
  const languageBlock: ReadyBlock | null = blocker
    ? {
        message: m.editor_language_blocker({
          language: uiLanguageName(blocker.locale),
          fields: fieldLabels(blocker.missing, fields).join(', '),
        }),
        onFix: () => {
          lang.setActive(blocker.locale)
          const first = blocker.missing[0]
          if (first) requestAnimationFrame(() => reveal(first))
        },
      }
    : null
  const readyBlock: ReadyBlock | null =
    conflictReadyBlock(
      editor.conflict !== null,
      () => void editor.reloadServerDraft(),
    ) ?? languageBlock

  // Writes the active language. On the main language (and single-language
  // sites) this is the ordinary update, which also keeps the slug in step
  // with the title.
  function onLocaleChange(key: string, value: unknown) {
    if (!ctx || !active) {
      editor.updateField(key, value)
      return
    }
    if (lang.isMain && baseLocale(data, ctx) === lang.main) {
      editor.updateField(key, value)
      return
    }
    editor.updateLocaleField(
      translatedSlug && !lang.isMain && key === slugField?.key ? SLUG_KEY : key,
      value,
      active,
      ctx,
    )
  }

  useShortcut('mod+s', () => void editor.save())

  // Copy to production: dev envs only (docs/design/dev-environments.md, Decision 18).
  const copyAction = useCopyEntryAction({
    devSiteId: siteId,
    productionSiteId: site.parentSiteId,
    isDevelopment: isDevSite(site),
    collectionKey:
      copyDestination.kind === 'collection'
        ? copyDestination.collectionKey
        : copyDestination.globalKey,
    destination: copyDestination,
    devEntryId: editor.entryId,
    save: editor.save,
  })

  return {
    lang,
    ctx,
    active,
    summaries,
    view,
    mainView,
    /** The language row under the top bar is shown. */
    multilingual: Boolean(lang.languages && ctx && active),
    aiEnabled,
    translate,
    translateEnabled,
    localeFields,
    readyBlock,
    onLocaleChange,
    copyAction,
  }
}

export type EditorSession = ReturnType<typeof useEditorSession>
