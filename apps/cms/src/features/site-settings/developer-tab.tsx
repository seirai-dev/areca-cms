import * as React from 'react'
import { useRouter } from '@tanstack/react-router'
import { ArrowsClockwise, Plugs, Stack } from '@phosphor-icons/react'
import { toast } from 'sonner'

import { errorMessage } from '#/lib/errors'
import { isValidSlug } from '#/lib/slug'
import { Button } from '#/components/ui/button'
import { ConfirmDialog } from '#/components/ui/confirm-dialog'
import { CopyButton } from '#/components/ui/copy-button'
import { EmptyState } from '#/components/ui/empty-state'
import { InsetIcon } from '#/components/ui/inset-list'
import { Input } from '#/components/ui/input'
import { SettingsSection } from '#/components/ui/settings-section'
import { collectionIcon } from '#/lib/site-nav'
import { m } from '#/paraglide/messages'

import { TokenReveal } from './token-reveal'
import type { SiteRecord, useSiteSettings } from './use-site-settings'

function useOrigin() {
  const [origin, setOrigin] = React.useState('')
  React.useEffect(() => setOrigin(window.location.origin), [])
  return origin
}

const SKILLS_COMMAND = 'npx @areca-cms/skills'

/**
 * Settings › Developer (brief §3.10): the site key, token rotation with a
 * one-time reveal, and what the site project last synced (`lastManifest`)
 * with a quick-start snippet.
 */
export function DeveloperTab({
  site,
  settings,
}: {
  site: SiteRecord
  settings: ReturnType<typeof useSiteSettings>
}) {
  const [token, setToken] = React.useState<string | null>(null)
  const [schemaToken, setSchemaToken] = React.useState<string | null>(null)
  const router = useRouter()
  const [editingSlug, setEditingSlug] = React.useState(false)
  const [slugDraft, setSlugDraft] = React.useState(site.slug)
  const [slugConfirm, setSlugConfirm] = React.useState(false)
  const [slugError, setSlugError] = React.useState<string | null>(null)
  const slugChanged = slugDraft.trim() !== site.slug
  const slugValid = isValidSlug(slugDraft.trim())
  const origin = useOrigin()
  const commands = [
    'npm install @areca-cms/site-sdk',
    `npx areca init --cms-url ${origin || 'https://cms.example.com'} --site-key ${site.slug}`,
    'npx areca manifest push',
  ].join('\n')

  const collections = Object.entries(site.lastManifest?.collections ?? {})

  return (
    <div data-testid="settings-developer">
      <SettingsSection
        title={m.settings_site_key_title()}
        description={m.settings_site_key_description()}
      >
        <div className="grid gap-1.5">
          <label htmlFor="settings-site-slug" className="sr-only">
            {m.settings_site_key_title()}
          </label>
          {editingSlug ? (
            <form
              className="grid gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                if (slugChanged && slugValid) setSlugConfirm(true)
              }}
            >
              <Input
                id="settings-site-slug"
                data-testid="settings-site-slug-input"
                autoFocus
                spellCheck={false}
                autoComplete="off"
                value={slugDraft}
                onChange={(event) => {
                  setSlugDraft(event.target.value)
                  setSlugError(null)
                }}
                aria-invalid={slugDraft !== '' && !slugValid}
                className="font-mono text-[13px]"
              />
              <p
                className="text-caption font-normal text-text-muted"
                data-testid="settings-site-slug-hint"
              >
                {slugError ??
                  (slugDraft !== '' && !slugValid
                    ? m.server_site_slug_invalid()
                    : m.settings_site_key_draft_hint())}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="submit"
                  size="sm"
                  disabled={
                    !slugChanged || !slugValid || settings.changeSlug.isPending
                  }
                  data-testid="settings-site-slug-save"
                >
                  {m.settings_site_key_save()}
                </Button>
                <Button
                  type="button"
                  variant="quiet"
                  size="sm"
                  onClick={() => {
                    setEditingSlug(false)
                    setSlugDraft(site.slug)
                    setSlugError(null)
                  }}
                >
                  {m.shared_cancel()}
                </Button>
              </div>
            </form>
          ) : (
            <div className="grid gap-2">
              {/* Full width on its own line: the key is the thing to read. */}
              <Input
                id="settings-site-slug"
                data-testid="settings-site-slug"
                readOnly
                value={site.slug}
                className="w-full min-w-0 font-mono text-[13px]"
                onFocus={(event) => event.currentTarget.select()}
              />
              <div className="flex flex-wrap items-center gap-2">
                <CopyButton
                  value={site.slug}
                  label={m.sites_slug_copy()}
                  copiedLabel={m.sites_slug_copied_label()}
                  toastMessage={m.sites_slug_copied()}
                  aria-label={m.sites_slug_copy_aria()}
                  variant="secondary"
                  size="md"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  onClick={() => {
                    setSlugDraft(site.slug)
                    setEditingSlug(true)
                  }}
                  data-testid="settings-site-slug-change"
                >
                  {m.settings_site_key_change()}
                </Button>
              </div>
            </div>
          )}
          {editingSlug ? null : (
            <p className="text-caption font-normal text-text-muted">
              {m.settings_site_key_hint()}
            </p>
          )}
        </div>
        <ConfirmDialog
          open={slugConfirm}
          onOpenChange={setSlugConfirm}
          title={m.settings_site_key_change_title()}
          description={m.settings_site_key_change_description({
            from: site.slug,
            to: slugDraft.trim(),
          })}
          confirmLabel={m.settings_site_key_change_confirm()}
          variant="destructive"
          testId="change-site-key-dialog"
          onConfirm={async () => {
            const next = slugDraft.trim()
            try {
              await settings.changeSlug.mutateAsync(next)
              toast.success(m.settings_site_key_changed())
              setEditingSlug(false)
              // The connector URL on Connect AI now carries the new key.
              void router.navigate({
                to: '/sites/$siteId/connect-ai',
                params: { siteId: site.id },
              })
            } catch (error) {
              setSlugError(errorMessage(error))
            }
          }}
        />
      </SettingsSection>

      <SettingsSection
        id="token"
        title={m.settings_build_token_title()}
        description={m.settings_token_description()}
      >
        {token ? (
          <TokenReveal token={token} onDismiss={() => setToken(null)} />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="max-w-[52ch] text-callout text-text-secondary">
              {m.settings_token_body()}
            </p>
            <ConfirmDialog
              title={m.sites_rotate_token_title()}
              description={m.sites_rotate_token_description()}
              confirmLabel={m.sites_rotate_token()}
              variant="destructive"
              testId="rotate-token-dialog"
              onConfirm={async () => {
                const result = await settings.rotate.mutateAsync('build')
                toast.success(m.sites_token_rotated())
                setToken(result.token)
              }}
            >
              <Button
                type="button"
                variant="outline"
                loading={settings.rotate.isPending}
                data-testid="rotate-token"
              >
                {settings.rotate.isPending ? null : <ArrowsClockwise />}
                {m.settings_rotate_button()}
              </Button>
            </ConfirmDialog>
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        title={m.settings_schema_token_title()}
        description={m.settings_schema_token_description()}
      >
        {schemaToken ? (
          <TokenReveal
            token={schemaToken}
            privilege="schema"
            onDismiss={() => setSchemaToken(null)}
          />
        ) : (
          <ConfirmDialog
            title={m.settings_schema_token_rotate_title()}
            description={m.settings_schema_token_rotate_description()}
            confirmLabel={m.settings_schema_token_rotate()}
            variant="destructive"
            onConfirm={async () => {
              const result = await settings.rotate.mutateAsync('schema')
              setSchemaToken(result.token)
            }}
          >
            <Button variant="outline" loading={settings.rotate.isPending}>
              {m.settings_schema_token_rotate()}
            </Button>
          </ConfirmDialog>
        )}
      </SettingsSection>

      <SettingsSection
        title={m.settings_manifest_title()}
        description={m.settings_manifest_description()}
        bare
      >
        <div className="grid gap-4">
          {collections.length > 0 ? (
            <div
              className="overflow-hidden surface-card"
              data-testid="manifest-status"
            >
              <p className="flex items-center gap-2 border-b border-border-default px-4 py-3 text-[14px] leading-5 font-medium text-text-primary">
                <Plugs
                  weight="duotone"
                  className="size-[18px] text-icon-success"
                />
                {collections.length === 1
                  ? m.settings_manifest_synced_one()
                  : m.settings_manifest_synced({ count: collections.length })}
              </p>
              <ul>
                {collections.map(([key, collection]) => {
                  const Icon = collectionIcon(key, collection.label)
                  return (
                    <li
                      key={key}
                      className="flex items-center gap-3 border-b border-border-default px-4 py-2.5 last:border-b-0"
                    >
                      <InsetIcon tone="accent">
                        <Icon />
                      </InsetIcon>
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <span className="truncate text-[14px] leading-5 font-medium text-text-primary">
                          {collection.label ?? key}
                        </span>
                        <span className="truncate text-mono text-text-muted">
                          {key} · {collection.route}
                        </span>
                      </span>
                      <span className="shrink-0 text-caption font-normal text-text-muted tnum">
                        {collection.fields.length === 1
                          ? m.settings_field_count_one({ count: 1 })
                          : m.settings_field_count_other({
                              count: collection.fields.length,
                            })}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : (
            <EmptyState
              card
              size="sm"
              tone="neutral"
              icon={<Stack weight="duotone" />}
              title={m.settings_manifest_none()}
              description={m.settings_manifest_none_body()}
              data-testid="manifest-status"
            />
          )}

          <div className="grid gap-1.5">
            <div className="flex items-center justify-between gap-3 px-0.5">
              <span className="text-caption text-text-muted">
                {m.settings_quickstart()}
              </span>
              <CopyButton
                value={commands}
                label={m.settings_copy_commands()}
                toastMessage={m.settings_commands_copied()}
                variant="quiet"
                size="xs"
                data-testid="copy-quickstart"
              />
            </div>
            <pre
              className="scroll-quiet overflow-x-auto rounded-card bg-background-inverse px-4 py-3.5 text-mono whitespace-pre text-text-inverse dark:border dark:border-border-default dark:bg-background-subtle dark:text-text-primary"
              data-testid="quickstart-snippet"
            >
              <code>
                {commands.split('\n').map((line) => (
                  <span key={line} className="block">
                    <span className="opacity-50 select-none">$ </span>
                    {line}
                  </span>
                ))}
              </code>
            </pre>
            <p className="px-0.5 text-caption font-normal text-text-muted">
              {m.settings_quickstart_hint()}
            </p>
          </div>

          <div className="grid gap-1.5">
            <div className="flex items-center justify-between gap-3 px-0.5">
              <span className="text-caption text-text-muted">
                {m.settings_agent_skills()}
              </span>
              <CopyButton
                value={SKILLS_COMMAND}
                label={m.connect_ai_reveal_copy_command()}
                toastMessage={m.connect_ai_copied_toast()}
                variant="quiet"
                size="xs"
                data-testid="copy-agent-skills"
              />
            </div>
            <pre
              className="scroll-quiet overflow-x-auto rounded-card bg-background-inverse px-4 py-3.5 text-mono whitespace-pre text-text-inverse dark:border dark:border-border-default dark:bg-background-subtle dark:text-text-primary"
              data-testid="agent-skills-snippet"
            >
              <code>
                <span className="opacity-50 select-none">$ </span>
                {SKILLS_COMMAND}
              </code>
            </pre>
            <p className="px-0.5 text-caption font-normal text-text-muted">
              {m.settings_agent_skills_hint()}
            </p>
          </div>
        </div>
      </SettingsSection>
    </div>
  )
}
