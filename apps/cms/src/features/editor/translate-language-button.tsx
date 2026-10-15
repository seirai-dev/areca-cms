import { Translate } from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'
import { Hint } from '#/components/ui/tooltip'
import { m } from '#/paraglide/messages'

/**
 * The language bar's "Translate from <main>" action. Icon only below `sm`,
 * with the full label as its accessible name. While running it shows a
 * spinner and "Translating…". Disabled, it explains why on hover and focus.
 */
export function TranslateLanguageButton({
  label,
  running,
  disabled = false,
  disabledReason,
  onClick,
}: {
  /** "Translate from Dutch". */
  label: string
  running: boolean
  disabled?: boolean
  /** Tooltip shown while disabled, e.g. "Add Dutch text first". */
  disabledReason?: string
  onClick: () => void
}) {
  const text = running ? m.editor_translate_running() : label
  const button = (
    <Button
      type="button"
      variant="quiet"
      size="sm"
      aria-label={text}
      data-testid="translate-language"
      loading={running}
      disabled={disabled}
      onClick={onClick}
      className="text-text-secondary"
    >
      {running ? null : <Translate />}
      <span className="hidden sm:inline">{text}</span>
    </Button>
  )
  return disabled && disabledReason ? (
    <Hint label={disabledReason}>{button}</Hint>
  ) : (
    button
  )
}
