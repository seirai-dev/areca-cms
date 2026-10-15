import * as React from 'react'
import { useServerFn } from '@tanstack/react-start'
import { Plus, Trash, DotsSixVertical, Translate } from '@phosphor-icons/react'
import { Reorder, useDragControls, useReducedMotion } from 'motion/react'
import { toast } from 'sonner'

import { errorMessage } from '#/lib/admin/helpers'
import { MAX_SITE_LANGUAGES } from '#/lib/content-limits'
import {
  SITE_LANGUAGE_CATALOG,
  browserLanguageTag,
  canonicalTag,
  languageEndonym,
  languageEnglishName,
  uiLanguageName,
} from '#/lib/site-languages'
import { Button } from '#/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '#/components/ui/command'
import { ConfirmDialog } from '#/components/ui/confirm-dialog'
import { EmptyState } from '#/components/ui/empty-state'
import { FormField } from '#/components/ui/form-field'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { SettingsSection } from '#/components/ui/settings-section'
import { Hint } from '#/components/ui/tooltip'
import { m } from '#/paraglide/messages'
import { previewMainLanguageChangeFn } from '#/server/fn/admin'
import type { SiteLanguages } from '#/lib/types'

import { SettingsSaveBar } from './settings-save-bar'
import type { SiteRecord, useSiteSettings } from './use-site-settings'

type Draft = SiteLanguages | null

function sameLanguages(a: SiteLanguages | null, b: SiteLanguages | null) {
  if (!a || !b) return a === b
  return (
    a.main === b.main &&
    a.all.length === b.all.length &&
    a.all.every((tag, index) => tag === b.all[index])
  )
}

/**
 * Settings › Languages (agency only): the site's languages in site order,
 * the main language (the fallback), and add / remove. Removing hides a
 * language, it keeps the data. Changing main shows how many entries lack the
 * new main first. See docs/design/content-languages.md.
 */
export function LanguagesTab({
  site,
  settings,
}: {
  site: SiteRecord
  settings: ReturnType<typeof useSiteSettings>
}) {
  const formId = React.useId()
  const radioName = React.useId()
  const previewMain = useServerFn(previewMainLanguageChangeFn)
  const saved = site.languages ?? null
  const [draft, setDraft] = React.useState<Draft>(saved)
  const [pendingMain, setPendingMain] = React.useState<{
    tag: string
    gaps: number
  } | null>(null)
  const [pendingRemove, setPendingRemove] = React.useState<string | null>(null)

  // Follow the server copy until the user starts editing.
  const savedKey = JSON.stringify(saved)
  React.useEffect(() => setDraft(saved), [savedKey])

  const dirty = !sameLanguages(draft, saved)
  const saving = settings.setLanguages.isPending

  async function chooseMain(tag: string) {
    if (!draft || tag === draft.main) return
    // Changing an existing site's main language stamps its data: show the
    // gap count first.
    if (!saved || tag === saved.main) {
      setDraft({ ...draft, main: tag })
      return
    }
    try {
      const { gaps } = await previewMain({ data: { id: site.id, main: tag } })
      setPendingMain({ tag, gaps })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  function addLanguage(tag: string) {
    if (!draft || draft.all.includes(tag)) return
    setDraft({ ...draft, all: [...draft.all, tag] })
  }

  function save(event: React.FormEvent) {
    event.preventDefault()
    if (!draft) return
    settings.setLanguages
      .mutateAsync({ main: draft.main, all: draft.all })
      .then(() => toast.success(m.languages_saved()))
      .catch((error: unknown) => toast.error(errorMessage(error)))
  }

  if (!draft) {
    return (
      <div data-testid="settings-languages">
        <EmptyLanguages onStart={(main) => setDraft({ main, all: [main] })} />
      </div>
    )
  }

  // Dialogs are sentences: the names follow the CMS language.
  const removeName = pendingRemove ? uiLanguageName(pendingRemove) : ''
  const mainName = pendingMain ? uiLanguageName(pendingMain.tag) : ''

  return (
    <div data-testid="settings-languages">
      <form id={formId} noValidate onSubmit={save}>
        <SettingsSection
          title={m.languages_list_title()}
          description={m.languages_list_description()}
        >
          <div
            className="overflow-hidden surface-card"
            data-testid="language-list"
          >
            <Reorder.Group
              axis="y"
              as="ol"
              values={draft.all}
              onReorder={(next: string[]) => setDraft({ ...draft, all: next })}
              className="relative"
            >
              {draft.all.map((tag) => (
                <LanguageRow
                  key={tag}
                  tag={tag}
                  isMain={tag === draft.main}
                  radioName={radioName}
                  onMain={() => void chooseMain(tag)}
                  onRemove={() => setPendingRemove(tag)}
                />
              ))}
            </Reorder.Group>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
            {draft.all.length >= MAX_SITE_LANGUAGES ? (
              <p className="text-callout text-text-secondary">
                {m.languages_limit_reached({ max: MAX_SITE_LANGUAGES })}
              </p>
            ) : null}
            <AddLanguage
              taken={draft.all}
              disabled={draft.all.length >= MAX_SITE_LANGUAGES}
              onAdd={addLanguage}
            />
          </div>
        </SettingsSection>
      </form>

      <ConfirmDialog
        open={pendingMain !== null}
        onOpenChange={(open) => {
          if (!open) setPendingMain(null)
        }}
        title={m.languages_main_change_title({ language: mainName })}
        description={
          pendingMain && pendingMain.gaps > 0
            ? pendingMain.gaps === 1
              ? m.languages_main_change_gaps_one({ language: mainName })
              : m.languages_main_change_gaps_other({
                  count: pendingMain.gaps,
                  language: mainName,
                })
            : m.languages_main_change_no_gaps({ language: mainName })
        }
        confirmLabel={m.languages_main_change_confirm()}
        onConfirm={() => {
          if (pendingMain) {
            setDraft({ ...draft, main: pendingMain.tag })
          }
          setPendingMain(null)
        }}
      />

      <ConfirmDialog
        open={pendingRemove !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemove(null)
        }}
        title={m.languages_remove_title({ language: removeName })}
        description={m.languages_remove_description({ language: removeName })}
        confirmLabel={m.languages_remove_confirm()}
        confirmText={removeName}
        variant="destructive"
        testId="remove-language-dialog"
        onConfirm={() => {
          if (pendingRemove) {
            setDraft({
              ...draft,
              all: draft.all.filter((tag) => tag !== pendingRemove),
            })
          }
          setPendingRemove(null)
        }}
      />

      <SettingsSaveBar
        dirty={dirty}
        saving={saving}
        formId={formId}
        onDiscard={() => setDraft(saved)}
        saveTestId="save-languages"
      />
    </div>
  )
}

/** Empty state: a main-language picker (prefilled from the browser) and the start. */
function EmptyLanguages({ onStart }: { onStart: (main: string) => void }) {
  const [main, setMain] = React.useState(() => browserLanguageTag())
  const pickerId = React.useId()
  return (
    <EmptyState
      card
      icon={<Translate weight="duotone" />}
      title={m.languages_empty_title()}
      description={m.languages_empty_description()}
      data-testid="languages-empty"
      action={
        <div className="grid w-full max-w-sm gap-3 text-left">
          <FormField
            label={m.languages_main_label()}
            htmlFor={pickerId}
            hint={m.languages_main_hint()}
          >
            <Select value={main} onValueChange={setMain}>
              <SelectTrigger
                id={pickerId}
                data-testid="languages-main-picker"
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SITE_LANGUAGE_CATALOG.map((tag) => (
                  <SelectItem key={tag} value={tag}>
                    <span>{languageEndonym(tag)}</span>
                    <span className="text-mono text-text-muted">{tag}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <Button
            type="button"
            data-testid="add-languages"
            onClick={() => onStart(main)}
          >
            <Plus weight="bold" />
            {m.languages_add_languages()}
          </Button>
        </div>
      }
    />
  )
}

function LanguageRow({
  tag,
  isMain,
  radioName,
  onMain,
  onRemove,
}: {
  tag: string
  isMain: boolean
  radioName: string
  onMain: () => void
  onRemove: () => void
}) {
  const controls = useDragControls()
  const reduce = useReducedMotion()
  const endonym = languageEndonym(tag)
  const english = languageEnglishName(tag)
  return (
    <Reorder.Item
      value={tag}
      as="li"
      dragListener={false}
      dragControls={controls}
      data-testid={`language-row-${tag}`}
      layout={reduce ? undefined : 'position'}
      className="relative flex min-h-[60px] flex-wrap items-center gap-x-3 gap-y-2 bg-background-surface px-3 py-2.5 after:absolute after:right-0 after:bottom-0 after:left-[52px] after:h-px after:bg-border-default last:after:hidden"
    >
      <button
        type="button"
        aria-label={m.languages_reorder({ language: endonym })}
        onPointerDown={(event) => controls.start(event)}
        className="grid size-7 shrink-0 cursor-grab touch-none place-content-center rounded-[8px] text-icon-muted outline-none hover:bg-surface-state-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-border-focus active:cursor-grabbing"
      >
        <DotsSixVertical weight="bold" className="size-4" />
      </button>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span
            className="truncate text-[14px] leading-5 font-medium text-text-primary"
            data-testid={`language-name-${tag}`}
          >
            {endonym}
          </span>
          {english !== endonym ? (
            <span className="truncate text-callout text-text-secondary">
              {english}
            </span>
          ) : null}
        </span>
        <span className="text-mono text-text-muted">{tag}</span>
      </span>
      <label className="flex cursor-pointer items-center gap-2 text-callout text-text-secondary">
        <input
          type="radio"
          name={radioName}
          value={tag}
          checked={isMain}
          onChange={onMain}
          data-testid={`language-main-${tag}`}
          className="size-4 accent-accent"
        />
        {m.languages_main_label()}
      </label>
      <Hint label={isMain ? m.languages_remove_main_blocked() : ''}>
        <Button
          type="button"
          variant="quiet"
          size="icon-sm"
          className="shrink-0 text-icon-muted hover:text-text-error"
          disabled={isMain}
          aria-label={m.languages_remove({ language: endonym })}
          data-testid={`language-remove-${tag}`}
          onClick={onRemove}
        >
          <Trash />
        </Button>
      </Hint>
    </Reorder.Item>
  )
}

/** "Add language": a searchable list of common tags, or any valid typed tag. */
function AddLanguage({
  taken,
  disabled,
  onAdd,
}: {
  taken: string[]
  disabled: boolean
  onAdd: (tag: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const typed = query.trim() ? canonicalTag(query.trim()) : null
  const customTag =
    typed &&
    !taken.includes(typed) &&
    !(SITE_LANGUAGE_CATALOG as readonly string[]).includes(typed)
      ? typed
      : null
  const options = SITE_LANGUAGE_CATALOG.filter((tag) => !taken.includes(tag))

  function pick(tag: string) {
    onAdd(tag)
    setOpen(false)
    setQuery('')
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery('')
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled}
          data-testid="add-language"
        >
          <Plus weight="bold" />
          {m.languages_add()}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <Command>
          <CommandInput
            placeholder={m.languages_search_placeholder()}
            value={query}
            onValueChange={setQuery}
            data-testid="language-search"
          />
          <CommandList className="max-h-72">
            <CommandEmpty>{m.languages_no_match()}</CommandEmpty>
            {customTag ? (
              <CommandGroup>
                <CommandItem
                  value={`use ${customTag}`}
                  onSelect={() => pick(customTag)}
                  data-testid="language-use-custom"
                >
                  {m.languages_use_code({ code: customTag })}
                </CommandItem>
              </CommandGroup>
            ) : null}
            <CommandGroup>
              {options.map((tag) => (
                <CommandItem
                  key={tag}
                  value={`${tag} ${languageEndonym(tag)} ${languageEnglishName(tag)}`}
                  onSelect={() => pick(tag)}
                  data-testid={`language-option-${tag}`}
                >
                  <span className="grid min-w-0 flex-1">
                    <span className="truncate font-medium">
                      {languageEndonym(tag)}
                    </span>
                    <span className="truncate text-caption text-text-secondary">
                      {languageEnglishName(tag)}
                    </span>
                  </span>
                  <span className="text-mono text-text-muted">{tag}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
