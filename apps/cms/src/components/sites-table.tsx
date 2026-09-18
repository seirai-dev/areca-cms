import { useMemo } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { createDataColumns, DataTable } from '#/components/data-table'
import { EntityIcon } from '#/components/entity-icon'
import { formatDateTime } from '#/components/editor/utils'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import { cn } from '#/lib/utils'
import { formatRelativeTime } from '#/lib/relative-time'
import { m } from '#/paraglide/messages'
import { getLocale } from '#/paraglide/runtime'
import type { getSitesOverviewFn } from '#/server/fn/overview'
import { DotsThree, Gear, Globe, UploadSimple } from '@phosphor-icons/react'

export type SiteOverviewRow = Awaited<
  ReturnType<typeof getSitesOverviewFn>
>['sites'][number]

const helper = createDataColumns<SiteOverviewRow>()

/** Clicks on links and menus inside a row must not trigger the row itself. */
function stopRowClick(event: React.MouseEvent) {
  event.stopPropagation()
}

/**
 * The sites list on the home page: what each site is, whether it is live, and
 * how much work is waiting to go out. The whole row opens the site.
 */
export function SitesTable({
  sites,
  showOrganization,
  isAgencyAdmin,
  caption,
  emptyMessage,
}: {
  sites: SiteOverviewRow[]
  showOrganization: boolean
  isAgencyAdmin: boolean
  caption: string
  emptyMessage?: string
}) {
  const navigate = useNavigate()

  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor('name', {
          header: m.admin_name(),
          enableSorting: false,
          cell: ({ row }) => (
            <div className="flex min-w-0 max-w-[15rem] items-center gap-3 p-3">
              <EntityIcon icon={Globe} size="sm" />
              <div className="min-w-0">
                <Link
                  to="/sites/$siteId"
                  params={{ siteId: row.original.id }}
                  onClick={stopRowClick}
                  className="block truncate font-medium hover:underline"
                >
                  {row.original.name}
                </Link>
                <p className="truncate text-ds-mono-xs text-text-muted">
                  {row.original.slug}
                </p>
              </div>
            </div>
          ),
        }),
        ...(showOrganization
          ? [
              helper.accessor('organizationName', {
                header: m.shell_breadcrumb_organization(),
                enableSorting: false,
                meta: { className: 'hidden md:table-cell' },
                cell: ({ row }) => (
                  <span className="block max-w-[8rem] truncate text-text-muted">
                    {row.original.organizationName}
                  </span>
                ),
              }),
            ]
          : []),
        helper.accessor('live', {
          header: m.sites_column_status(),
          enableSorting: false,
          cell: ({ row }) =>
            row.original.live ? (
              row.original.liveSince ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="success" dot>
                      {m.editor_publication_live()}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    {m.home_live_since({
                      datetime: formatDateTime(row.original.liveSince),
                    })}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <Badge variant="success" dot>
                  {m.editor_publication_live()}
                </Badge>
              )
            ) : (
              <Badge variant="muted">{m.editor_not_live()}</Badge>
            ),
        }),
        helper.accessor('pendingEntries', {
          header: m.home_column_pending(),
          enableSorting: false,
          meta: { className: 'hidden sm:table-cell' },
          cell: ({ getValue }) => {
            const pending = getValue<number>()
            return (
              <span
                className={cn(
                  'tnum',
                  pending > 0 ? 'text-text-warning' : 'text-text-muted',
                )}
              >
                {pending}
              </span>
            )
          },
        }),
        helper.accessor('lastUpdated', {
          header: m.editor_updated(),
          enableSorting: false,
          meta: { className: 'hidden lg:table-cell' },
          cell: ({ row }) => (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="whitespace-nowrap text-text-muted">
                  {formatRelativeTime(row.original.lastUpdated)}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {formatDateTime(row.original.lastUpdated)}
              </TooltipContent>
            </Tooltip>
          ),
        }),
        helper.display({
          id: 'actions',
          header: () => <span className="sr-only">{m.sites_actions()}</span>,
          enableSorting: false,
          cell: ({ row }) => (
            <div className="flex justify-end" onClick={stopRowClick}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={m.sites_actions()}
                  >
                    <DotsThree />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <Link
                      to="/sites/$siteId"
                      params={{ siteId: row.original.id }}
                    >
                      <Globe />
                      {m.sites_open()}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link
                      to="/sites/$siteId"
                      params={{ siteId: row.original.id }}
                    >
                      <UploadSimple />
                      {m.home_publish()}
                    </Link>
                  </DropdownMenuItem>
                  {isAgencyAdmin ? (
                    <DropdownMenuItem asChild>
                      <Link
                        to="/sites/$siteId/settings"
                        params={{ siteId: row.original.id }}
                      >
                        <Gear />
                        {m.shell_nav_settings()}
                      </Link>
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ),
        }),
      ]),
    [showOrganization, isAgencyAdmin, getLocale()],
  )

  return (
    <DataTable
      columns={columns}
      data={sites}
      caption={caption}
      emptyMessage={emptyMessage}
      getRowProps={(row) => ({
        className: 'cursor-pointer',
        onClick: () =>
          navigate({ to: '/sites/$siteId', params: { siteId: row.id } }),
      })}
    />
  )
}
