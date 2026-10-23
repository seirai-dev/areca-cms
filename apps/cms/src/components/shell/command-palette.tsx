import * as React from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import type { NavigateOptions } from '@tanstack/react-router'
import { useTheme } from 'next-themes'
import {
  CircleHalf,
  MagnifyingGlass,
  Notebook,
  Plus,
  Pulse,
  RocketLaunch,
  SignOut,
  Translate,
  UploadSimple,
  UserPlus,
} from '@phosphor-icons/react'

import { queryKeys } from '#/lib/content/query-keys'
import { entryTitle } from '#/lib/content/utils'
import { useShell } from '#/components/shell/shell-context'
import { SiteTile } from '#/components/shell/site-tile'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandMeta,
} from '#/components/ui/command'
import { Kbd } from '#/components/ui/kbd'
import { EntryStatusPill } from '#/components/ui/status-pill'
import { Spinner } from '#/components/ui/spinner'
import { entryUiStatus } from '#/features/golive/entry-live-state'
import {
  GLOBAL_ROUTE,
  siteContentNavItems,
} from '#/features/globals/site-content'
import { useSiteGlobals } from '#/features/globals/use-globals'
import { useReleaseStatus } from '#/features/golive/use-release-status'
import { usePanel } from '#/features/shell/panel'
import { useDebouncedValue } from '#/hooks/use-debounced-value'
import { signOutClient } from '#/lib/sign-out'
import {
  agencyNavItems,
  canManageSite,
  collectionIcon,
  displayHost,
  newEntryLabel,
  siteNavItems,
} from '#/lib/site-nav'
import { m } from '#/paraglide/messages'
import {
  getLocale,
  locales,
  localizeHref,
  setLocale,
} from '#/paraglide/runtime'
import { listCollectionsFn, listEntriesFn } from '#/server/fn/content'

import { LOCALE_LABELS } from './account-menu'

/**
 * Spotlight-style command palette (brief §3.12). ⌘K anywhere. Groups: Search
 * entries (debounced, across the current site's enabled collections), Go to,
 * Create, Actions, Agency.
 */
export function CommandPalette() {
  const { me, site, mode, paletteOpen, setPaletteOpen } = useShell()
  const navigate = useNavigate()
  const { resolvedTheme, setTheme } = useTheme()
  const [search, setSearch] = React.useState('')
  const needle = useDebouncedValue(search.trim(), 220)
  const inSite = mode !== 'agency' && site ? site : undefined
  const canManage = inSite ? canManageSite(me, inSite.organizationId) : false
  const release = useReleaseStatus(paletteOpen ? inSite?.id : undefined)
  const panel = usePanel()

  React.useEffect(() => {
    if (!paletteOpen) setSearch('')
  }, [paletteOpen])

  const collectionsQuery = useQuery({
    queryKey: queryKeys.collections(inSite?.id ?? ''),
    queryFn: () => listCollectionsFn({ data: { siteId: inSite!.id } }),
    enabled: Boolean(inSite) && paletteOpen,
  })
  const collections = (collectionsQuery.data ?? []).filter((c) => c.enabled)
  const globalsQuery = useSiteGlobals(paletteOpen ? inSite?.id : undefined)
  const sections = siteContentNavItems(globalsQuery.data ?? [], {
    isAgencyAdmin: false,
  })

  const searching = needle.length >= 2 && Boolean(inSite)
  const hits = useQueries({
    queries: collections.map((collection) => ({
      queryKey: ['palette-search', inSite?.id, collection.key, needle] as const,
      queryFn: async () =>
        (
          await listEntriesFn({
            data: {
              siteId: inSite!.id,
              collectionKey: collection.key,
              search: needle,
              limit: 5,
              offset: 0,
            },
          })
        ).items,
      enabled: searching && paletteOpen,
      staleTime: 15_000,
    })),
  })
  const searchingNow = searching && hits.some((hit) => hit.isFetching)

  function run(action: () => void) {
    setPaletteOpen(false)
    action()
  }

  function go(options: NavigateOptions) {
    run(() => void navigate(options))
  }

  const entryResults = searching
    ? collections.flatMap((collection, index) =>
        (hits[index]?.data ?? []).map((entry) => ({ entry, collection })),
      )
    : []

  // Entry hits arrive after the typed filter has already picked a row; move
  // the highlight to the first hit when they land (Spotlight behaviour).
  const [highlighted, setHighlighted] = React.useState('')
  const firstHit = entryResults[0]
    ? `entry ${entryResults[0].entry.id}`
    : undefined
  React.useEffect(() => {
    if (firstHit) setHighlighted(firstHit)
  }, [firstHit])

  return (
    <CommandDialog
      open={paletteOpen}
      onOpenChange={setPaletteOpen}
      commandProps={{
        loop: true,
        value: highlighted,
        onValueChange: setHighlighted,
      }}
    >
      <CommandInput
        size="lg"
        value={search}
        onValueChange={setSearch}
        placeholder={
          inSite
            ? m.shell_palette_placeholder_site({ site: inSite.name })
            : m.shell_palette_placeholder()
        }
        data-testid="command-input"
        trailing={
          searchingNow ? (
            <Spinner size={16} className="text-icon-muted" />
          ) : (
            <Kbd className="hidden sm:inline-flex">esc</Kbd>
          )
        }
      />
      <CommandList data-testid="command-palette">
        <CommandEmpty>
          {searchingNow ? m.shell_palette_searching() : m.shell_search_empty()}
        </CommandEmpty>

        {entryResults.length > 0 ? (
          <CommandGroup heading={m.shell_palette_entries()}>
            {entryResults.map(({ entry, collection }) => {
              const Icon = collectionIcon(collection.key, collection.label)
              const title = entryTitle(
                entry.draftData,
                collection.fields,
                entry.slug,
              )
              return (
                <CommandItem
                  key={`${collection.key}-${entry.id}`}
                  value={`entry ${entry.id}`}
                  keywords={[needle, title, entry.slug]}
                  onSelect={() =>
                    go({
                      to: '/sites/$siteId/c/$collectionKey/$entryId',
                      params: {
                        siteId: inSite!.id,
                        collectionKey: collection.key,
                        entryId: entry.id,
                      },
                    })
                  }
                >
                  <Icon />
                  <span className="grid min-w-0 flex-1">
                    <span className="truncate">{title}</span>
                    <span
                      data-slot="command-meta"
                      className="truncate text-[12px] leading-4 text-text-muted"
                    >
                      {collection.label}
                    </span>
                  </span>
                  <EntryStatusPill
                    size="sm"
                    status={entryUiStatus(entry, release.liveMembership)}
                  />
                </CommandItem>
              )
            })}
          </CommandGroup>
        ) : null}

        {inSite ? (
          <CommandGroup heading={m.shell_palette_go_to()}>
            {siteNavItems(me, inSite).map((item) => (
              <CommandItem
                key={item.key}
                value={`go ${item.label}`}
                onSelect={() =>
                  go({ to: item.to, params: { siteId: inSite.id } })
                }
              >
                <item.icon />
                {item.label}
                {item.shortcut ? (
                  <CommandMeta>
                    <span className="inline-flex gap-0.5">
                      <Kbd>G</Kbd>
                      <Kbd>{item.shortcut.toUpperCase()}</Kbd>
                    </span>
                  </CommandMeta>
                ) : null}
              </CommandItem>
            ))}
            {collections.map((collection) => {
              const Icon = collectionIcon(collection.key, collection.label)
              return (
                <CommandItem
                  key={collection.id}
                  value={`go ${collection.label} ${collection.key}`}
                  onSelect={() =>
                    go({
                      to: '/sites/$siteId/c/$collectionKey',
                      params: {
                        siteId: inSite.id,
                        collectionKey: collection.key,
                      },
                    })
                  }
                >
                  <Icon />
                  {collection.label}
                  <CommandMeta>{m.shell_palette_content()}</CommandMeta>
                </CommandItem>
              )
            })}
            {sections.map((section) => (
              <CommandItem
                key={`global-${section.key}`}
                value={`go ${section.label} ${section.key}`}
                onSelect={() =>
                  go({
                    to: GLOBAL_ROUTE,
                    params: {
                      siteId: inSite.id,
                      globalKey: section.key,
                    },
                  })
                }
              >
                <Notebook />
                {section.label}
                <CommandMeta>{m.globals_nav_group()}</CommandMeta>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {inSite && collections.length > 0 ? (
          <CommandGroup heading={m.shell_palette_create()}>
            {collections.map((collection) => (
              <CommandItem
                key={`new-${collection.id}`}
                value={`create new ${collection.label} ${collection.key}`}
                onSelect={() =>
                  go({
                    to: '/sites/$siteId/c/$collectionKey/new',
                    params: {
                      siteId: inSite.id,
                      collectionKey: collection.key,
                    },
                  })
                }
              >
                <Plus />
                {newEntryLabel(collection.label)}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        <CommandGroup heading={m.shell_search_actions()}>
          {inSite && canManage ? (
            <>
              <CommandItem
                value="action go live publish"
                onSelect={() => run(() => panel.open('golive'))}
              >
                <RocketLaunch />
                {m.golive_go_live()}
              </CommandItem>
              <CommandItem
                value="action invite people"
                onSelect={() =>
                  go({
                    to: '/sites/$siteId/people',
                    params: { siteId: inSite.id },
                    search: { invite: 1 },
                  })
                }
              >
                <UserPlus />
                {m.shell_palette_invite()}
              </CommandItem>
            </>
          ) : null}
          {inSite ? (
            <CommandItem
              value="action upload library"
              onSelect={() =>
                go({
                  to: '/sites/$siteId/library',
                  params: { siteId: inSite.id },
                })
              }
            >
              <UploadSimple />
              {m.shell_palette_upload()}
            </CommandItem>
          ) : null}
          {inSite && canManage ? (
            <CommandItem
              value="action open activity"
              onSelect={() => run(() => panel.open('activity'))}
            >
              <Pulse />
              {m.shell_palette_open_activity()}
            </CommandItem>
          ) : null}
          <CommandItem
            value="action switch appearance theme dark light"
            onSelect={() =>
              run(() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'))
            }
          >
            <CircleHalf />
            {m.shell_palette_switch_appearance()}
          </CommandItem>
          {locales
            .filter((code) => code !== getLocale())
            .map((code) => (
              <CommandItem
                key={code}
                value={`action language ${LOCALE_LABELS[code]} ${code}`}
                onSelect={() => run(() => setLocale(code))}
              >
                <Translate />
                {m.shell_palette_language({ language: LOCALE_LABELS[code] })}
              </CommandItem>
            ))}
          <CommandItem
            value="action sign out"
            onSelect={() =>
              run(() => {
                void signOutClient().finally(() => {
                  window.location.assign(localizeHref('/login'))
                })
              })
            }
          >
            <SignOut />
            {m.shell_sign_out()}
          </CommandItem>
        </CommandGroup>

        {me.sites.length > (inSite ? 1 : 0) ? (
          <CommandGroup heading={m.shell_palette_sites()}>
            {me.sites
              .filter((item) => item.id !== inSite?.id)
              .map((item) => (
                <CommandItem
                  key={item.id}
                  value={`site ${item.name} ${item.organizationName} ${item.slug}`}
                  onSelect={() =>
                    go({ to: '/sites/$siteId', params: { siteId: item.id } })
                  }
                >
                  <SiteTile id={item.id} name={item.name} size="xs" />
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  <CommandMeta>
                    {displayHost(item.productionUrl) || item.organizationName}
                  </CommandMeta>
                </CommandItem>
              ))}
          </CommandGroup>
        ) : null}

        {me.user.isAgencyAdmin ? (
          <CommandGroup heading={m.shell_agency()}>
            {agencyNavItems().map((item) => (
              <CommandItem
                key={item.key}
                value={`agency ${item.label}`}
                onSelect={() => go({ to: item.to })}
              >
                <item.icon />
                {item.label}
                <CommandMeta>{m.shell_agency()}</CommandMeta>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
      <div className="flex items-center gap-4 border-t border-border-default px-4 py-2.5 text-[12px] text-text-muted max-sm:hidden">
        <span className="flex items-center gap-1.5">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          {m.shell_palette_hint_move()}
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>↵</Kbd>
          {m.shell_palette_hint_open()}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <MagnifyingGlass className="size-3.5" />
          {inSite
            ? m.shell_palette_hint_scope({ site: inSite.name })
            : m.shell_agency()}
        </span>
      </div>
    </CommandDialog>
  )
}
