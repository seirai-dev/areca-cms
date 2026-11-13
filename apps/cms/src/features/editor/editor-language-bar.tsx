import { uiLanguageName } from '#/lib/site-languages'
import type { Field } from '#/lib/types'
import { m } from '#/paraglide/messages'

import { LanguageBar } from './language-bar'
import { TranslateLanguageButton } from './translate-language-button'
import type { EditorSession } from './use-editor-session'

/**
 * The language row of an editor's sticky header, with "Translate from main"
 * on a translation when AI is set up. Nothing on single-language sites.
 */
export function EditorLanguageBar({
  session,
  fields,
}: {
  session: EditorSession
  fields: Field[]
}) {
  const { lang, active, translate } = session
  if (!session.multilingual || !active) return null
  const mainName = uiLanguageName(lang.main)
  return (
    <LanguageBar
      main={lang.main}
      active={active}
      summaries={session.summaries}
      fields={fields}
      onSelect={lang.setActive}
      trailing={
        session.translateEnabled && !lang.isMain ? (
          <TranslateLanguageButton
            label={m.editor_translate_language({ language: mainName })}
            running={translate.pendingScope === 'language'}
            disabled={!translate.hasSource}
            disabledReason={m.editor_translate_add_source({
              language: mainName,
            })}
            onClick={translate.translateLanguage}
          />
        ) : undefined
      }
    />
  )
}
