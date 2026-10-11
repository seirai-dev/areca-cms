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
    <p
      className="rounded-card bg-background-subtle px-4 py-3 text-callout text-text-secondary"
      data-testid="connect-ai-role-note"
    >
      {text}
    </p>
  )
}
