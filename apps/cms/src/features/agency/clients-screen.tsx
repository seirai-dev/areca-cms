import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Buildings, MagnifyingGlass, Plus } from '@phosphor-icons/react'
import { toast } from 'sonner'

import { suggestSlug } from '#/lib/admin/helpers'
import { queryKeys } from '#/lib/query-keys'
import { errorMessage } from '#/lib/errors'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { FormField } from '#/components/ui/form-field'
import { InsetList, InsetRow } from '#/components/ui/inset-list'
import { Input } from '#/components/ui/input'
import { PageHeader } from '#/components/ui/page-header'
import { QueryError } from '#/components/ui/query-error'
import { Skeleton } from '#/components/ui/skeleton'
import { SlideOver } from '#/components/ui/slide-over'
import { formatRelativeTime } from '#/lib/relative-time'
import { m } from '#/paraglide/messages'
import { getLocale } from '#/paraglide/runtime'
import { createOrganizationFn } from '#/server/fn/admin'

import { ClientTile } from './client-tile'
import { clientsQuery } from './queries'
import type { ClientRow } from './queries'
import { SlugField } from './slug-field'

/** "3 sites · 5 people". */
export function clientCounts(
  client: Pick<ClientRow, 'siteCount' | 'memberCount'>,
) {
  return [
    client.siteCount === 1
      ? m.agency_count_sites_one()
      : m.agency_count_sites({ count: client.siteCount }),
    client.memberCount === 1
      ? m.agency_count_people_one()
      : m.agency_count_people({ count: client.memberCount }),
  ].join(' · ')
}

function addedOn(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value)
  return m.agency_client_added({
    date: new Intl.DateTimeFormat(getLocale(), {
      day: 'numeric',
      month: 'short',
      year:
        date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    }).format(date),
  })
}

/**
 * `/agency/clients` (brief §3.11): every client as an inset row (initials
 * tile, name, "3 sites · 5 people", when it was added), search, and the
 * primary New client sheet.
 */
export function ClientsScreen({
  createOpen,
  onCreateOpenChange,
}: {
  createOpen: boolean
  onCreateOpenChange: (open: boolean) => void
}) {
  const clients = useQuery(clientsQuery())
  const [search, setSearch] = React.useState('')
  const rows = clients.data ?? []
  const needle = search.trim().toLowerCase()
  const visible = needle
    ? rows.filter((client) =>
        `${client.name} ${client.slug}`.toLowerCase().includes(needle),
      )
    : rows
  const empty = clients.isSuccess && rows.length === 0

  return (
    <div
      className="grid gap-8"
      data-testid="organizations-page"
      data-ready={clients.isFetched ? 'true' : 'false'}
    >
      <PageHeader
        title={m.shell_nav_clients()}
        description={m.agency_clients_description()}
        actions={
          empty ? null : (
            <Button
              type="button"
              data-testid="new-organization"
              onClick={() => onCreateOpenChange(true)}
            >
              <Plus />
              {m.agency_new_client()}
            </Button>
          )
        }
      />

      {clients.isError ? (
        <QueryError title={m.agency_clients_load_error()} query={clients} />
      ) : clients.isPending ? (
        <div className="grid gap-3" aria-busy="true">
          <Skeleton className="h-9 w-full max-w-sm" />
          <div className="overflow-hidden surface-card">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="flex items-center gap-3 border-b border-border-default px-4 py-3 last:border-b-0"
              >
                <Skeleton className="size-10 rounded-[11px]" />
                <div className="grid flex-1 gap-2">
                  <Skeleton className="h-3.5 w-40" />
                  <Skeleton className="h-3 w-28" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : empty ? (
        <EmptyState
          card
          icon={<Buildings weight="duotone" />}
          title={m.agency_clients_empty_title()}
          description={m.agency_clients_empty_body()}
          action={
            <Button
              type="button"
              data-testid="new-organization"
              onClick={() => onCreateOpenChange(true)}
            >
              <Plus />
              {m.agency_new_client()}
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4">
          <div className="relative w-full sm:max-w-sm">
            <MagnifyingGlass className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-icon-muted" />
            <Input
              id="org-search"
              type="search"
              aria-label={m.agency_clients_search()}
              placeholder={m.agency_clients_search()}
              className="pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              data-shortcut-search
            />
          </div>
          {visible.length === 0 ? (
            <EmptyState
              size="sm"
              tone="neutral"
              icon={<MagnifyingGlass />}
              title={m.home_no_results_title()}
              description={m.agency_clients_no_match({ search: search.trim() })}
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setSearch('')}
                >
                  {m.sites_clear_search()}
                </Button>
              }
            />
          ) : (
            <InsetList data-testid="clients-list">
              {visible.map((client) => (
                <InsetRow
                  key={client.id}
                  asChild
                  chevron
                  className="min-h-[64px]"
                  leading={<ClientTile id={client.id} name={client.name} />}
                  title={client.name}
                  subtitle={clientCounts(client)}
                  trailing={
                    <span
                      className="hidden text-caption font-normal text-text-muted sm:inline"
                      title={formatRelativeTime(client.createdAt)}
                    >
                      {addedOn(client.createdAt)}
                    </span>
                  }
                >
                  <Link
                    to="/agency/clients/$orgId"
                    params={{ orgId: client.id }}
                    data-testid={`client-row-${client.slug}`}
                  />
                </InsetRow>
              ))}
            </InsetList>
          )}
        </div>
      )}

      <NewClientSheet open={createOpen} onOpenChange={onCreateOpenChange} />
    </div>
  )
}

/** Create a client, then open it. */
function useCreateClient(onCreated: () => void) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: (input: { name: string; slug: string }) =>
      createOrganizationFn({ data: input }),
    onSuccess: async (client) => {
      toast.success(m.agency_client_created())
      onCreated()
      await queryClient.invalidateQueries({
        queryKey: queryKeys.organizations(),
      })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.sitesOverview(),
      })
      await navigate({
        to: '/agency/clients/$orgId',
        params: { orgId: client.id },
      })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
}

function NewClientSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [name, setName] = React.useState('')
  const [slug, setSlug] = React.useState('')
  const [slugTouched, setSlugTouched] = React.useState(false)
  const create = useCreateClient(() => {
    setName('')
    setSlug('')
    setSlugTouched(false)
  })

  return (
    <SlideOver
      open={open}
      onOpenChange={(next) => {
        if (!create.isPending) onOpenChange(next)
      }}
      title={m.agency_new_client()}
      description={m.agency_new_client_description()}
      data-testid="new-client-sheet"
      footer={
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={create.isPending}
          >
            {m.admin_cancel()}
          </Button>
          <Button
            type="submit"
            form="new-client-form"
            loading={create.isPending}
            data-testid="create-client"
          >
            {m.agency_create_client()}
          </Button>
        </div>
      }
    >
      <form
        id="new-client-form"
        className="grid gap-5 pt-2"
        onSubmit={(event) => {
          event.preventDefault()
          create.mutate({ name: name.trim(), slug: slug.trim() })
        }}
      >
        <FormField label={m.agency_client_name()} htmlFor="org-name">
          <Input
            id="org-name"
            data-testid="org-name"
            required
            autoFocus
            autoComplete="organization"
            placeholder={m.agency_client_name_placeholder()}
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              if (!slugTouched) setSlug(suggestSlug(event.target.value))
            }}
          />
        </FormField>
        <SlugField
          id="org-slug"
          testId="org-slug"
          value={slug}
          onChange={setSlug}
          touched={slugTouched}
          onTouched={() => setSlugTouched(true)}
          hint={m.agency_client_slug_hint()}
        />
      </form>
    </SlideOver>
  )
}
