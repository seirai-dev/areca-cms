import { createFileRoute } from '@tanstack/react-router'

import { AuditLogList } from '#/components/admin/audit-log-list'
import { PageHeader } from '#/components/page-header'

export const Route = createFileRoute('/_app/admin/audit')({
  component: AuditPage,
})

function AuditPage() {
  return (
    <div className="grid gap-6">
      <PageHeader title="Audit log" description="Recent agency actions." />
      <AuditLogList />
    </div>
  )
}
