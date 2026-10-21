import {
  Article,
  File,
  House,
  ImageSquare,
  MagnifyingGlass,
  RocketLaunch,
} from '@phosphor-icons/react'

import { BrandLogo } from '#/components/brand-mark'
import { AuthArt } from '#/features/auth/auth-art'
import {
  brandingPreviewStyle,
  fontEntry,
  fontStylesheetUrl,
  loginTaglineFor,
} from '#/lib/branding'
import type { BrandingView } from '#/lib/branding'
import { cn } from '#/lib/utils'
import { getLocale } from '#/paraglide/runtime'
import { m } from '#/paraglide/messages'

/**
 * Live preview (brief §3.11): a mini mock of the sidebar, a card and a
 * button, in light and dark side by side. Each panel re-declares the whole
 * token set (`.light` / `.dark`) plus the draft accent, so both render
 * correctly whatever theme the page itself is in. Tokens only.
 *
 * Below the mini app, the sign-in art (what the login page shows) in light and
 * dark, with the tagline for the language the admin is using.
 */
export function BrandingPreview({ branding }: { branding: BrandingView }) {
  const fontUrl = fontStylesheetUrl(branding.font)
  return (
    <aside
      className="grid content-start gap-3"
      aria-label={m.admin_branding_preview_aria()}
    >
      {fontUrl ? <link rel="stylesheet" href={fontUrl} /> : null}
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 className="text-overline text-text-muted">
          {m.admin_branding_preview()}
        </h2>
        <span className="text-caption font-normal text-text-muted">
          {m.agency_branding_preview_live()}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <PreviewPanel
          branding={branding}
          mode="light"
          testId="branding-preview"
        />
        <PreviewPanel
          branding={branding}
          mode="dark"
          testId="branding-preview-dark"
        />
      </div>
      <div className="grid gap-2" data-testid="branding-signin-preview">
        <h3 className="px-1 text-caption font-normal text-text-muted">
          {m.agency_branding_signin_title()}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <SignInArtPanel
            branding={branding}
            mode="light"
            testId="branding-signin-preview-light"
          />
          <SignInArtPanel
            branding={branding}
            mode="dark"
            testId="branding-signin-preview-dark"
          />
        </div>
      </div>
      <p className="px-1 text-caption font-normal text-text-muted">
        {m.admin_branding_preview_footnote()}
      </p>
    </aside>
  )
}

function PreviewPanel({
  branding,
  mode,
  testId,
}: {
  branding: BrandingView
  mode: 'light' | 'dark'
  testId: string
}) {
  return (
    <div
      data-testid={testId}
      data-theme={mode}
      aria-label={
        mode === 'dark'
          ? m.admin_branding_dark_palette()
          : m.admin_branding_light_palette()
      }
      role="img"
      className={cn(
        mode,
        'grid min-w-0 overflow-hidden rounded-card border border-border-default bg-background-default text-text-primary shadow-card',
      )}
      style={{
        ...brandingPreviewStyle(branding, mode),
        fontFamily: fontEntry(branding.font).family,
      }}
    >
      {/* Sidebar */}
      <div className="grid gap-1 border-b border-border-default bg-sidebar p-2.5">
        <div className="flex min-w-0 items-center gap-2 px-1 pb-1.5">
          <BrandLogo branding={branding} size="sm" />
          <span className="truncate text-[12.5px] leading-4 font-semibold">
            {branding.appName}
          </span>
        </div>
        <div className="mb-1 flex h-6 items-center gap-1.5 rounded-[7px] border border-border-default bg-background-surface px-2 text-[10.5px] text-text-muted">
          <MagnifyingGlass className="size-3" />
          {m.shell_search()}
        </div>
        <PreviewNav
          icon={<House weight="fill" className="size-3.5" />}
          label={m.shell_nav_overview()}
          active
        />
        <PreviewNav
          icon={<Article className="size-3.5" />}
          label={m.agency_branding_preview_articles()}
          count="12"
        />
        <PreviewNav
          icon={<File className="size-3.5" />}
          label={m.agency_branding_preview_pages()}
          count="4"
        />
        <PreviewNav
          icon={<ImageSquare className="size-3.5" />}
          label={m.shell_nav_library()}
        />
      </div>
      {/* Card + button */}
      <div className="grid gap-2.5 p-2.5">
        <div className="grid gap-1.5 rounded-[11px] border border-border-default bg-background-surface p-2.5 shadow-card">
          <span className="inline-flex w-fit items-center gap-1 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] leading-3 font-medium text-accent-text">
            <span className="size-1.5 rounded-full bg-accent" />
            {m.shell_status_ready()}
          </span>
          <span className="text-[12px] leading-4 font-semibold">
            {m.agency_branding_preview_card_title()}
          </span>
          <span className="text-[10.5px] leading-[14px] text-text-secondary">
            {m.agency_branding_preview_card_body()}{' '}
            <span className="text-text-accent underline underline-offset-2">
              {m.admin_branding_pangram_link()}
            </span>
          </span>
          <span className="mt-0.5 flex items-center gap-1.5">
            <span className="relative inline-flex h-3.5 w-6 items-center rounded-full bg-accent p-[2px]">
              <span className="ml-auto size-2.5 rounded-full bg-white shadow-sm" />
            </span>
            <span className="text-[10px] text-text-muted">
              {m.agency_branding_preview_switch()}
            </span>
          </span>
        </div>
        <span className="flex h-7 items-center justify-center gap-1.5 rounded-[8px] bg-action-primary text-[11.5px] font-medium text-action-primary-text">
          <RocketLaunch weight="fill" className="size-3" />
          {m.golive_go_live()}
        </span>
      </div>
    </div>
  )
}

function SignInArtPanel({
  branding,
  mode,
  testId,
}: {
  branding: BrandingView
  mode: 'light' | 'dark'
  testId: string
}) {
  return (
    <div
      data-testid={testId}
      data-theme={mode}
      className={cn(mode, 'min-w-0')}
      style={{
        ...brandingPreviewStyle(branding, mode),
        fontFamily: fontEntry(branding.font).family,
      }}
    >
      <AuthArt
        branding={branding}
        tagline={
          loginTaglineFor(branding, getLocale()) ?? m.auth_tagline_default()
        }
        size="sm"
        className="aspect-[4/5]"
      />
    </div>
  )
}

function PreviewNav({
  icon,
  label,
  active = false,
  count,
}: {
  icon: React.ReactNode
  label: string
  active?: boolean
  count?: string
}) {
  return (
    <span
      className={cn(
        'flex h-6 min-w-0 items-center gap-1.5 rounded-[7px] px-1.5 text-[11px] leading-4',
        active
          ? 'bg-accent-soft font-medium text-text-primary [&>svg]:text-icon-accent'
          : 'text-text-secondary',
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
      {count ? (
        <span className="ml-auto text-[10px] text-text-muted tnum">
          {count}
        </span>
      ) : null}
    </span>
  )
}
