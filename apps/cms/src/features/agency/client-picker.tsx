import * as React from 'react'
import { Check, Plus } from '@phosphor-icons/react'

import { ClientTile } from '#/features/agency/client-tile'
import { Button } from '#/components/ui/button'
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
} from '#/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/ui/popover'
import { SegmentedControl } from '#/components/ui/segmented-control'
import { SlideOver } from '#/components/ui/slide-over'
import { Tag } from '#/components/ui/tag'
import { useIsMobile } from '#/hooks/use-mobile'
import { membershipRoleLabel } from '#/lib/admin/helpers'
import { cn } from '#/lib/utils'
import type { MembershipRole } from '#/lib/types'
import { m } from '#/paraglide/messages'

import type { ClientPick } from './person/access-stage'
import type { ClientRow } from './queries'

/**
 * Multi-select of clients, shared by the person page, the invite sheet and
 * the bulk bar. A popover on desktop and a bottom sheet on phones. Clients the
 * person already has are listed disabled with their role; clients already
 * staged by the caller are checked. The footer sets the role for the new picks.
 *
 * Keys: ↑/↓ move, Enter toggles the highlighted client, Space toggles it too
 * while the search is empty (so a space still types in a search).
 */
export function ClientPicker({
  clients,
  existing,
  staged,
  onAdd,
  children,
  side = 'bottom',
  align = 'start',
}: {
  clients: ClientRow[]
  /** Clients the person is already in, with their role. Disabled here. */
  existing?: ReadonlyMap<string, MembershipRole>
  /** Clients the caller already holds. Checked here, not pickable again. */
  staged?: ReadonlySet<string>
  onAdd: (picks: ClientPick[], role: MembershipRole) => void
  /** The trigger button. */
  children: React.ReactElement<{ onClick?: React.MouseEventHandler }>
  side?: 'top' | 'bottom'
  align?: 'start' | 'center' | 'end'
}) {
  const mobile = useIsMobile()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [picked, setPicked] = React.useState<ReadonlySet<string>>(new Set())
  const [role, setRole] = React.useState<MembershipRole>('editor')
  const [highlight, setHighlight] = React.useState('')

  const needle = query.trim().toLowerCase()
  const visible = React.useMemo(
    () =>
      clients
        .filter(
          (client) =>
            !needle ||
            client.name.toLowerCase().includes(needle) ||
            client.slug.toLowerCase().includes(needle),
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [clients, needle],
  )

  // Start on the first client you can still pick, so Enter does something.
  React.useEffect(() => {
    const first = visible.find(
      (client) => !existing?.has(client.id) && !staged?.has(client.id),
    )
    setHighlight(first?.id ?? '')
  }, [visible, existing, staged, open])

  function toggle(id: string) {
    if (existing?.has(id) || staged?.has(id)) return
    setPicked((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function close(next: boolean) {
    setOpen(next)
    if (!next) {
      setQuery('')
      setPicked(new Set())
      // Each opening starts from the default role (Editor).
      setRole('editor')
    }
  }

  const picks: ClientPick[] = clients
    .filter((client) => picked.has(client.id))
    .map((client) => ({
      organizationId: client.id,
      name: client.name,
      slug: client.slug,
    }))

  function submit() {
    if (picks.length === 0) return
    onAdd(picks, role)
    close(false)
  }

  const list = (
    <Command
      loop
      shouldFilter={false}
      value={highlight}
      onValueChange={setHighlight}
      className="bg-transparent"
    >
      <CommandInput
        placeholder={m.agency_clients_search()}
        aria-label={m.agency_clients_search()}
        value={query}
        onValueChange={setQuery}
        onKeyDown={(event) => {
          if (event.key === ' ' && query === '' && highlight) {
            event.preventDefault()
            toggle(highlight)
          }
        }}
        data-testid="client-picker-search"
      />
      <CommandList className="max-h-[300px] max-sm:max-h-none max-sm:flex-1">
        {visible.length === 0 ? (
          <p className="px-3 py-8 text-center text-callout text-text-muted">
            {needle
              ? m.agency_clients_no_match({ search: query.trim() })
              : m.agency_clients_empty_title()}
          </p>
        ) : null}
        {visible.map((client) => {
          const current = existing?.get(client.id)
          const isStaged = staged?.has(client.id) ?? false
          const checked = picked.has(client.id) || isStaged || Boolean(current)
          return (
            <CommandItem
              key={client.id}
              value={client.id}
              disabled={Boolean(current) || isStaged}
              onSelect={() => toggle(client.id)}
              className="data-[disabled=true]:opacity-60"
              data-testid={`client-picker-option-${client.slug}`}
            >
              {/* Already in the client: a muted check, not a selection. */}
              <span
                aria-hidden="true"
                className={cn(
                  'grid size-[18px] shrink-0 place-content-center rounded-[6px] border border-border-strong bg-background-surface text-accent-contrast',
                  current && 'border-border-default text-icon-muted',
                  !current && checked && 'border-accent bg-accent',
                )}
              >
                {current || checked ? (
                  <Check weight="bold" className="size-3" />
                ) : null}
              </span>
              <ClientTile id={client.id} name={client.name} size="sm" />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate text-[14px] leading-5 text-text-primary">
                  {client.name}
                </span>
                <span className="truncate text-caption font-normal text-text-muted tnum">
                  {client.siteCount === 1
                    ? m.agency_picker_sites_one()
                    : m.agency_picker_sites({ count: client.siteCount })}
                </span>
              </span>
              {current ? (
                <Tag tone="neutral">{membershipRoleLabel(current)}</Tag>
              ) : null}
            </CommandItem>
          )
        })}
      </CommandList>
    </Command>
  )

  const footer = (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <span className="text-caption font-medium text-text-secondary">
          {m.agency_picker_role_label()}
        </span>
        <SegmentedControl
          size="sm"
          fullWidth
          aria-label={m.agency_picker_role_label()}
          value={role}
          onValueChange={setRole}
          data-testid="client-picker-role"
          options={[
            {
              value: 'editor',
              label: m.admin_role_editor(),
              testId: 'client-picker-role-editor',
            },
            {
              value: 'owner',
              label: m.admin_role_owner(),
              testId: 'client-picker-role-owner',
            },
          ]}
        />
      </div>
      <Button
        type="button"
        disabled={picks.length === 0}
        onClick={submit}
        data-testid="client-picker-add"
        className="w-full"
      >
        <Plus />
        {picks.length === 0
          ? m.agency_picker_add_none()
          : picks.length === 1
            ? m.agency_picker_add_one()
            : m.agency_picker_add({ count: picks.length })}
      </Button>
    </div>
  )

  if (mobile) {
    const trigger = React.cloneElement(children, {
      onClick: (event: React.MouseEvent) => {
        children.props.onClick?.(event)
        setOpen(true)
      },
    })
    return (
      <>
        {trigger}
        <SlideOver
          open={open}
          onOpenChange={close}
          nested
          title={m.agency_picker_title()}
          data-testid="client-picker"
          footer={footer}
          bodyClassName="flex min-h-0 flex-col px-0 pb-0"
        >
          {list}
        </SlideOver>
      </>
    )
  }

  return (
    <Popover open={open} onOpenChange={close}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        data-testid="client-picker"
        className="w-[340px] p-0"
      >
        <div className="p-1.5">{list}</div>
        <div className="border-t border-border-default p-3">{footer}</div>
      </PopoverContent>
    </Popover>
  )
}
