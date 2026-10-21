import * as React from 'react'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'

import { LOCALE_LABELS } from '#/components/language-switcher'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { SettingsSection } from '#/components/ui/settings-section'
import { errorMessage } from '#/lib/admin/helpers'
import { m } from '#/paraglide/messages'
import { getLocale, locales } from '#/paraglide/runtime'
import type { Locale } from '#/paraglide/runtime'
import { updateEmailLocaleFn } from '#/server/fn/account'

function isLocale(value: string): value is Locale {
  return locales.some((locale) => locale === value)
}

/**
 * The language account and notification emails are sent in. It saves as soon
 * as a language is picked; the UI language is a separate setting.
 */
export function EmailLanguageSection({ locale }: { locale: Locale | null }) {
  const router = useRouter()
  const [pending, setPending] = React.useState(false)
  const current = locale ?? getLocale()

  async function change(next: string) {
    if (!isLocale(next) || next === current) return
    setPending(true)
    try {
      await updateEmailLocaleFn({ data: { locale: next } })
      toast.success(m.account_email_language_saved())
      await router.invalidate()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setPending(false)
    }
  }

  return (
    <SettingsSection
      id="email-language"
      title={m.account_email_language_title()}
      description={m.account_email_language_description()}
    >
      <Select value={current} onValueChange={(value) => void change(value)}>
        <SelectTrigger
          className="w-44"
          aria-label={m.account_email_language_aria()}
          disabled={pending}
          data-testid="email-language-select"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {locales.map((code) => (
            <SelectItem
              key={code}
              value={code}
              data-testid={`email-language-${code}`}
            >
              {LOCALE_LABELS[code]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsSection>
  )
}
