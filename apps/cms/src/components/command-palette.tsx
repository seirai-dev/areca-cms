import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { queryKeys } from '#/components/editor/query-keys'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '#/components/ui/command'
import { cn } from '#/lib/utils'
import {
  collectionFromPath,
  findSite,
  siteIdFromPath,
  siteSections,
} from '#/lib/site-nav'
import { m } from '#/paraglide/messages'
import { listCollectionsFn } from '#/server/fn/content'
import type { Me } from '#/server/fn/me'
import {
  Buildings,
  MoonStars,
  Plus,
  ClipboardText,
  FolderOpen,
  Globe,
  SquaresFour,
  Palette,
  MagnifyingGlass,
  Users,
} from '@phosphor-icons/react'

function useShortcutModifier() {
  // Resolved after mount so server and client render the same markup.
  const [modifier, setModifier] = useState('Ctrl')
  useEffect(() => {
    if (/Mac|iPhone|iPad/.test(navigator.platform)) setModifier('⌘')
  }, [])
  return modifier
}

/**
 * Global jump menu. Cmd/Ctrl+K opens it from anywhere inside the app; it lists
 * every site the user can reach, the sections and collections of the current
 * site, and the agency pages for admins.
 */
export function CommandPalette({ me }: { me: Me }) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const currentSite = findSite(me, siteIdFromPath(pathname))
  const currentCollection = collectionFromPath(pathname)?.collectionKey
  const { resolvedTheme, setTheme } = useTheme()

  const collectionsQuery = useQuery({
    queryKey: queryKeys.collections(currentSite?.id ?? ''),
    queryFn: () => listCollectionsFn({ data: { siteId: currentSite!.id } }),
    enabled: Boolean(currentSite) && open,
  })

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((value) => !value)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    function onOpen() {
      setOpen(true)
    }
    window.addEventListener('areca:open-command-palette', onOpen)
    return () =>
      window.removeEventListener('areca:open-command-palette', onOpen)
  }, [])

  function go(href: string) {
    setOpen(false)
    void navigate({ href })
  }

  const collections =
    collectionsQuery.data?.filter((collection) => collection.enabled) ?? []

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder={m.shell_search_placeholder()} />
      <CommandList>
        <CommandEmpty>{m.shell_search_empty()}</CommandEmpty>
        {currentSite ? (
          <>
            <CommandGroup heading={currentSite.name}>
              {siteSections(me, currentSite).map((section) => (
                <CommandItem
                  key={section.key}
                  value={`${currentSite.name} ${section.label}`}
                  onSelect={() => go(section.href)}
                >
                  <section.icon />
                  {section.label}
                </CommandItem>
              ))}
            </CommandGroup>
            {collections.length > 0 ? (
              <CommandGroup heading={m.shell_search_collections()}>
                {collections.map((collection) => (
                  <CommandItem
                    key={collection.id}
                    value={`${currentSite.name} ${collection.label} ${collection.key}`}
                    onSelect={() =>
                      go(`/sites/${currentSite.id}/c/${collection.key}`)
                    }
                  >
                    <FolderOpen />
                    {collection.label}
                    <span className="ml-auto text-ds-mono-xs text-text-muted">
                      {collection.key}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            <CommandSeparator />
          </>
        ) : null}
        <CommandGroup heading={m.shell_nav_sites()}>
          <CommandItem value="dashboard" onSelect={() => go('/')}>
            <SquaresFour />
            {m.shell_nav_all_sites()}
          </CommandItem>
          {me.sites.map((site) => (
            <CommandItem
              key={site.id}
              value={`${site.name} ${site.organizationName} ${site.slug}`}
              onSelect={() => go(`/sites/${site.id}`)}
            >
              <Globe />
              {site.name}
              <span className="ml-auto truncate text-xs text-muted-foreground">
                {site.organizationName}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
        {me.user.isAgencyAdmin ? (
          <>
            <CommandSeparator />
            <CommandGroup heading={m.shell_nav_agency()}>
              <CommandItem
                value="organizations"
                onSelect={() => go('/admin/organizations')}
              >
                <Buildings />
                {m.shell_nav_organizations()}
              </CommandItem>
              <CommandItem value="users" onSelect={() => go('/admin/users')}>
                <Users />
                {m.shell_nav_users()}
              </CommandItem>
              <CommandItem
                value="audit log"
                onSelect={() => go('/admin/audit')}
              >
                <ClipboardText />
                {m.shell_nav_audit_log()}
              </CommandItem>
              <CommandItem
                value="branding"
                onSelect={() => go('/admin/branding')}
              >
                <Palette />
                {m.shell_nav_branding()}
              </CommandItem>
            </CommandGroup>
          </>
        ) : null}
        <CommandSeparator />
        <CommandGroup heading={m.shell_search_actions()}>
          {currentCollection ? (
            <CommandItem
              value="new entry"
              onSelect={() =>
                go(`/sites/${currentSite!.id}/c/${currentCollection}/new`)
              }
            >
              <Plus />
              {m.shell_action_new_entry()}
            </CommandItem>
          ) : null}
          <CommandItem
            value="toggle theme"
            onSelect={() => {
              setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
              setOpen(false)
            }}
          >
            <MoonStars />
            {m.shell_action_toggle_theme()}
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}

/** Navbar button that opens the palette; also shows the shortcut. */
export function CommandPaletteTrigger({ className }: { className?: string }) {
  const modifier = useShortcutModifier()
  return (
    <button
      type="button"
      data-testid="open-search"
      aria-label={m.shell_search()}
      onClick={() =>
        window.dispatchEvent(new Event('areca:open-command-palette'))
      }
      className={cn(
        'flex h-9 items-center gap-2 rounded-control px-2 text-ds-body-sm text-text-muted transition-colors hover:bg-surface-state-hover hover:text-text-primary',
        className,
      )}
    >
      <MagnifyingGlass className="size-4" />
      <kbd className="hidden rounded border border-border-subtle px-1.5 py-0.5 font-sans text-[10px] font-medium text-text-muted sm:block">
        {modifier} K
      </kbd>
    </button>
  )
}
