import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { useTheme } from 'next-themes'
import {
  Check,
  DotsThree,
  Keyboard,
  Monitor,
  Moon,
  ShieldCheck,
  SignOut,
  Sun,
} from '@phosphor-icons/react'

import { useShell } from '#/components/shell/shell-context'
import { SHORTCUT_LIST } from '#/components/shell/shortcuts'
import { UserAvatar } from '#/components/ui/avatar'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Kbd, useModifierKey } from '#/components/ui/kbd'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/ui/popover'
import { SegmentedControl } from '#/components/ui/segmented-control'
import { Sheet, SheetContent, SheetTitle } from '#/components/ui/sheet'
import { Hint } from '#/components/ui/tooltip'
import { useIsMobile } from '#/hooks/use-mobile'
import { signOutClient } from '#/lib/sign-out'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import {
  getLocale,
  locales,
  localizeHref,
  setLocale,
} from '#/paraglide/runtime'
import type { Locale } from '#/paraglide/runtime'

export const LOCALE_LABELS = {
  en: 'English',
  nl: 'Nederlands',
  tr: 'Türkçe',
} as const satisfies Record<Locale, string>

type ThemeChoice = 'light' | 'dark' | 'system'

/** Light · Dark · Auto, as a segmented control (test id `theme-toggle`). */
function AppearanceControl({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])
  const value =
    (mounted ? (theme as ThemeChoice | undefined) : undefined) ?? 'system'
  return (
    <SegmentedControl<ThemeChoice>
      aria-label={m.shell_appearance()}
      data-testid="theme-toggle"
      size={size}
      fullWidth
      value={value}
      onValueChange={setTheme}
      options={[
        {
          value: 'light',
          label: m.shell_theme_light(),
          icon: <Sun />,
          testId: 'theme-light',
        },
        {
          value: 'dark',
          label: m.shell_theme_dark(),
          icon: <Moon />,
          testId: 'theme-dark',
        },
        {
          value: 'system',
          label: m.shell_theme_auto(),
          icon: <Monitor />,
          testId: 'theme-system',
        },
      ]}
    />
  )
}

const MENU_ROW = cn(
  'flex h-9 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[14px] text-text-primary outline-none transition-colors',
  'hover:bg-surface-state-hover focus-visible:bg-surface-state-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus',
  '[&_svg]:size-[18px] [&_svg]:shrink-0 [&_svg]:text-icon-default',
)

function AccountMenuBody({ onClose }: { onClose: () => void }) {
  const { me, setShortcutsOpen } = useShell()
  const locale = getLocale()
  const [signingOut, setSigningOut] = React.useState(false)

  async function signOut() {
    setSigningOut(true)
    try {
      await signOutClient()
    } finally {
      window.location.assign(localizeHref('/login'))
    }
  }

  return (
    <div className="grid gap-1" data-testid="account-menu">
      <div className="flex items-center gap-3 px-2.5 pt-1.5 pb-3">
        <UserAvatar name={me.user.name} size="lg" />
        <div className="grid min-w-0">
          <span className="truncate text-[14px] leading-5 font-semibold text-text-primary">
            {me.user.name}
          </span>
          <span className="truncate text-callout text-text-secondary">
            {me.user.email}
          </span>
        </div>
      </div>

      <div className="grid gap-2 border-t border-border-default px-2.5 pt-3 pb-2">
        <span className="text-overline text-text-muted">
          {m.shell_appearance()}
        </span>
        <AppearanceControl />
      </div>

      <div
        className="grid gap-0.5 border-t border-border-default pt-2"
        role="group"
        aria-label={m.shell_language()}
        data-testid="language-switcher"
      >
        <span className="px-2.5 pb-1 text-overline text-text-muted">
          {m.shell_language()}
        </span>
        {locales.map((code) => (
          <button
            key={code}
            type="button"
            aria-pressed={code === locale}
            lang={code}
            data-testid={`language-${code}`}
            className={MENU_ROW}
            onClick={() => {
              if (code !== locale) setLocale(code)
            }}
          >
            <span className="flex-1">{LOCALE_LABELS[code]}</span>
            {code === locale ? (
              <Check weight="bold" className="size-4! text-icon-accent!" />
            ) : null}
          </button>
        ))}
      </div>

      <div className="grid gap-0.5 border-t border-border-default pt-2">
        <Link
          to="/account"
          className={MENU_ROW}
          data-testid="open-account"
          onClick={onClose}
        >
          <ShieldCheck />
          <span className="flex-1">{m.shell_account_security()}</span>
        </Link>
        <button
          type="button"
          className={MENU_ROW}
          data-testid="open-shortcuts"
          onClick={() => {
            onClose()
            setShortcutsOpen(true)
          }}
        >
          <Keyboard />
          <span className="flex-1">{m.shell_keyboard_shortcuts()}</span>
        </button>
        <button
          type="button"
          className={MENU_ROW}
          data-testid="sign-out"
          disabled={signingOut}
          onClick={() => void signOut()}
        >
          <SignOut />
          <span className="flex-1">{m.shell_sign_out()}</span>
        </button>
      </div>
    </div>
  )
}

/**
 * The account row at the bottom of the sidebar (avatar, name, ⋯) and its
 * menu: name/email, Appearance, Language, Keyboard shortcuts…, Sign out
 * (brief §2.1). `variant="avatar"` is the mobile top-bar trigger; `rail`
 * the collapsed sidebar.
 */
export function AccountMenu({
  variant = 'row',
  testId = 'user-menu',
}: {
  variant?: 'row' | 'avatar' | 'rail'
  /** The mobile top bar passes `user-menu-mobile` (both bars exist in the DOM). */
  testId?: string
}) {
  const { me } = useShell()
  const [open, setOpen] = React.useState(false)
  const mobile = useIsMobile()

  const trigger =
    variant === 'row' ? (
      <button
        type="button"
        data-testid={testId}
        aria-label={m.shell_account_menu({ name: me.user.name })}
        className="group/account flex h-11 w-full min-w-0 items-center gap-2.5 rounded-[10px] px-2 text-left outline-none transition-colors hover:bg-surface-state-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus data-[state=open]:bg-surface-state-hover"
      >
        <UserAvatar
          name={me.user.name}
          size="sm"
          className="size-7 text-[11px]"
        />
        <span className="min-w-0 flex-1 truncate text-[14px] leading-5 font-medium text-text-primary">
          {me.user.name}
        </span>
        <DotsThree
          weight="bold"
          className="size-[18px] shrink-0 text-icon-muted group-hover/account:text-text-primary"
        />
      </button>
    ) : (
      <button
        type="button"
        data-testid={testId}
        aria-label={m.shell_account_menu({ name: me.user.name })}
        className="grid size-10 place-content-center rounded-full outline-none transition-transform active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
      >
        <UserAvatar name={me.user.name} size="default" />
      </button>
    )

  if (mobile) {
    return (
      <>
        {React.cloneElement(trigger, { onClick: () => setOpen(true) })}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="bottom"
            className="px-3 pt-1 pb-4"
            showCloseButton={false}
          >
            <SheetTitle className="sr-only">{m.shell_account()}</SheetTitle>
            <AccountMenuBody onClose={() => setOpen(false)} />
          </SheetContent>
        </Sheet>
      </>
    )
  }

  const popover = (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        side={variant === 'row' ? 'top' : 'right'}
        align={variant === 'row' ? 'start' : 'end'}
        sideOffset={8}
        className="w-[284px] p-1.5"
      >
        <AccountMenuBody onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
  return variant === 'rail' ? (
    <Hint label={me.user.name} side="right">
      <span className="inline-flex">{popover}</span>
    </Hint>
  ) : (
    popover
  )
}

/** "Keyboard shortcuts" dialog opened from the account menu. */
export function ShortcutsDialog() {
  const { shortcutsOpen, setShortcutsOpen } = useShell()
  const modifier = useModifierKey()
  const labels: Record<(typeof SHORTCUT_LIST)[number]['id'], string> = {
    palette: m.shell_shortcut_palette(),
    overview: m.shell_shortcut_overview(),
    library: m.shell_shortcut_library(),
    people: m.shell_shortcut_people(),
    switch: m.shell_shortcut_switch(),
    new: m.shell_shortcut_new(),
    search: m.shell_shortcut_search(),
    save: m.shell_shortcut_save(),
    details: m.shell_shortcut_details(),
  }
  return (
    <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
      <DialogContent size="sm" data-testid="shortcuts-dialog">
        <DialogHeader>
          <DialogTitle>{m.shell_keyboard_shortcuts()}</DialogTitle>
          <DialogDescription>
            {m.shell_shortcuts_description()}
          </DialogDescription>
        </DialogHeader>
        <ul className="-mx-1 grid">
          {SHORTCUT_LIST.map((shortcut) => (
            <li
              key={shortcut.id}
              className="flex h-10 items-center justify-between gap-4 border-b border-border-default px-1 last:border-b-0"
            >
              <span className="text-body text-text-primary">
                {labels[shortcut.id]}
              </span>
              <span className="flex items-center gap-1">
                {shortcut.keys.map((key, index) => (
                  <React.Fragment key={`${key}-${index}`}>
                    {index > 0 && shortcut.keys[0] === 'G' ? (
                      <span className="text-caption font-normal text-text-muted">
                        {m.shell_shortcut_then()}
                      </span>
                    ) : null}
                    <Kbd>{key === 'mod' ? modifier : key}</Kbd>
                  </React.Fragment>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
