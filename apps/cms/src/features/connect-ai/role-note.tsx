import { Info } from '@phosphor-icons/react'

import { m } from '#/paraglide/messages'

/** A role-specific sentence: what the viewer's AI is allowed to do here. */
export function RoleNote({ role }: { role: 'editor' | 'owner' | 'agency' }) {
  const text =
    role === 'editor'
      ? m.connect_ai_role_editor()
      : role === 'agency'
        ? m.connect_ai_role_agency()
        : m.connect_ai_role_owner()
  return (
    <div
      className="flex gap-3 rounded-card bg-background-subtle px-4 py-3.5"
      data-testid="connect-ai-role-note"
    >
      <Info
        weight="duotone"
        className="mt-px size-4 shrink-0 text-icon-muted"
        aria-hidden="true"
      />
      <p className="text-callout text-text-secondary">{text}</p>
    </div>
  )
}
