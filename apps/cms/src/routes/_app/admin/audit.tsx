import { createFileRoute } from '@tanstack/react-router'

import { AuditLogList } from '#/components/admin/audit-log-list'
import { PageHeader } from '#/components/ui/page-header'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/_app/admin/audit')({
  component: AuditPage,
})

function AuditPage() {
  return (
    <div className="grid gap-6">
      <PageHeader
        title={m.admin_audit_title()}
        description={m.admin_audit_description()}
      />
      <AuditLogList />
    </div>
  )
}
