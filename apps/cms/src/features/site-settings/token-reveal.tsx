import * as React from 'react'
import { useReducedMotion } from 'motion/react'
import * as motion from 'motion/react-m'
import { Key } from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'
import { CopyButton } from '#/components/ui/copy-button'
import { FADE, SPRING_SMALL } from '#/lib/motion'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

/** The two lines a site project needs in `.env.local`. */
function tokenEnvSnippet(
  cmsUrl: string,
  token: string,
  privilege: 'build' | 'schema',
) {
  return `ARECA_CMS_URL=${cmsUrl}\n${privilege === 'schema' ? 'ARECA_SCHEMA_TOKEN' : 'ARECA_SITE_TOKEN'}=${token}`
}

/** The CMS origin as the site project should call it (client only). */
function useCmsUrl(explicit?: string) {
  const [origin, setOrigin] = React.useState(explicit ?? '')
  React.useEffect(() => {
    if (!explicit) setOrigin(window.location.origin)
  }, [explicit])
  return explicit ?? origin
}

/**
 * One-time reveal of a freshly issued site token (brief §3.10 Developer,
 * §3.11 New site step 2): the token with a copy button, and a ready-to-paste
 * env snippet (`ARECA_CMS_URL=…`, `ARECA_SITE_TOKEN=…`).
 *
 * Shared by Settings › Developer (rotate) and the agency New-site flow.
 * Test ids: `site-token-alert` (root), `site-token-value` (the token text),
 * `site-token-env` (the snippet), `site-token-done` (dismiss).
 */
export function TokenReveal({
  token,
  privilege = 'build',
  cmsUrl,
  onDismiss,
  dismissLabel,
  className,
}: {
  token: string
  privilege?: 'build' | 'schema'
  /** Defaults to this CMS's origin. */
  cmsUrl?: string
  /** Shows a quiet "I've saved it" button when set. */
  onDismiss?: () => void
  dismissLabel?: string
  className?: string
}) {
  const reduce = useReducedMotion()
  const url = useCmsUrl(cmsUrl)
  const snippet = tokenEnvSnippet(url, token, privilege)

  return (
    <motion.div
      role="status"
      data-testid="site-token-alert"
      className={cn(
        'grid gap-4 rounded-card border border-[color-mix(in_oklab,var(--color-accent)_28%,transparent)] bg-[color-mix(in_oklab,var(--color-accent-soft)_55%,var(--color-background-surface))] p-4 sm:p-5',
        className,
      )}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.99 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      transition={reduce ? FADE : SPRING_SMALL}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-content-center rounded-[10px] bg-accent text-accent-contrast shadow-card"
        >
          <Key weight="fill" className="size-[18px]" />
        </span>
        <div className="grid min-w-0 gap-0.5">
          <p className="text-headline text-text-primary">
            {privilege === 'schema'
              ? m.settings_schema_token_reveal_title()
              : m.settings_token_reveal_title()}
          </p>
          <p className="text-callout text-text-secondary">
            {m.settings_token_reveal_body()}
          </p>
        </div>
      </div>

      <div className="grid gap-1.5">
        <div className="flex items-center justify-between gap-3 px-0.5">
          <span className="text-caption text-text-muted">
            {m.settings_token_reveal_token_label()}
          </span>
        </div>
        <div className="flex items-center gap-2 rounded-control border border-border-default bg-background-surface py-1.5 pr-1.5 pl-3">
          <code
            data-testid="site-token-value"
            className="min-w-0 flex-1 bg-transparent p-0 text-mono break-all text-text-primary select-all"
          >
            {token}
          </code>
          <CopyButton
            value={token}
            label={m.settings_token_reveal_copy_token()}
            copiedLabel={m.admin_token_copied_label()}
            toastMessage={m.admin_token_copied()}
            variant="secondary"
            size="xs"
            data-testid="site-token-copy"
            aria-label={m.admin_token_copy_aria()}
          />
        </div>
      </div>

      <div className="grid gap-1.5">
        <div className="flex items-center justify-between gap-3 px-0.5">
          <span className="text-caption text-text-muted">
            {m.settings_token_reveal_env_label()}
          </span>
          <CopyButton
            value={snippet}
            label={m.settings_token_reveal_copy_env()}
            copiedLabel={m.admin_token_copied_label()}
            toastMessage={m.settings_token_reveal_env_copied()}
            variant="quiet"
            size="xs"
            data-testid="site-token-env-copy"
          />
        </div>
        <pre
          data-testid="site-token-env"
          className="rounded-control bg-background-inverse px-3.5 py-3 text-mono whitespace-pre-wrap text-text-inverse [overflow-wrap:anywhere] dark:border dark:border-border-default dark:bg-background-subtle dark:text-text-primary"
        >
          <code>
            <span className="opacity-60">ARECA_CMS_URL=</span>
            {url}
            {'\n'}
            <span className="opacity-60">
              {privilege === 'schema'
                ? 'ARECA_SCHEMA_TOKEN='
                : 'ARECA_SITE_TOKEN='}
            </span>
            {token}
          </code>
        </pre>
        <p className="px-0.5 text-caption font-normal text-text-muted">
          {m.settings_token_reveal_env_hint()}
        </p>
      </div>

      {onDismiss ? (
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={onDismiss}
            data-testid="site-token-done"
          >
            {dismissLabel ?? m.settings_token_reveal_done()}
          </Button>
        </div>
      ) : null}
    </motion.div>
  )
}
