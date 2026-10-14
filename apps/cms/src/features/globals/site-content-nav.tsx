import { Link } from '@tanstack/react-router'
import { DotsThree, Notebook, Plus, Sliders } from '@phosphor-icons/react'

import { NavGroupLabel, NavItem } from '#/components/shell/nav-item'
import { useShell } from '#/components/shell/shell-context'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Tag } from '#/components/ui/tag'
import type { MeSite } from '#/lib/site-nav'
import { m } from '#/paraglide/messages'

import { GLOBAL_ROUTE, siteContentNavItems } from './site-content'
import { useSiteGlobals } from './use-globals'

/**
 * The "Site content" group of the site sidebar: one item per section. Editors
 * see enabled sections only and no group at all when there are none. The
 * agency also sees disabled sections (dimmed, "Off") and the structure links.
 */
export function SiteContentGroup({
  site,
  collapsed,
  onNavigate,
}: {
  site: MeSite
  collapsed: boolean
  onNavigate?: () => void
}) {
  const { me } = useShell()
  const isAgency = me.user.isAgencyAdmin
  const query = useSiteGlobals(site.id)
  const items = siteContentNavItems(query.data ?? [], {
    isAgencyAdmin: isAgency,
  })

  if (items.length === 0 && !isAgency) return null

  return (
    <div className="grid gap-0.5" data-testid="site-content-group">
      {collapsed ? (
        <div
          aria-hidden="true"
          className="mx-auto my-2 h-px w-6 bg-border-default"
        />
      ) : (
        <NavGroupLabel
          actions={
            isAgency ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="quiet"
                    size="icon-xs"
                    aria-label={m.globals_nav_menu()}
                    data-testid="site-content-menu"
                    className="size-6"
                  >
                    <DotsThree weight="bold" className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="right">
                  <DropdownMenuItem asChild>
                    <Link
                      to="/sites/$siteId/settings"
                      params={{ siteId: site.id }}
                      search={{ tab: 'content' }}
                      onClick={onNavigate}
                    >
                      <Plus />
                      {m.globals_nav_add_section()}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link
                      to="/sites/$siteId/settings"
                      params={{ siteId: site.id }}
                      search={{ tab: 'content' }}
                      onClick={onNavigate}
                    >
                      <Sliders />
                      {m.shell_edit_structure()}
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null
          }
        >
          {m.globals_nav_group()}
        </NavGroupLabel>
      )}
      {items.length === 0 ? (
        collapsed ? null : (
          <p className="px-2.5 py-1 text-[12.5px] leading-[18px] text-text-muted">
            {m.globals_nav_empty()}
          </p>
        )
      ) : (
        items.map((item) => (
          <NavItem
            key={item.key}
            link={{
              to: GLOBAL_ROUTE,
              params: { siteId: site.id, globalKey: item.key },
            }}
            icon={Notebook}
            label={item.label}
            collapsed={collapsed}
            muted={!item.enabled}
            testId={`site-content-item-${item.key}`}
            onNavigate={onNavigate}
            trailing={
              item.enabled ? null : (
                <Tag tone="outline">{m.shell_collection_off()}</Tag>
              )
            }
          />
        ))
      )}
    </div>
  )
}
