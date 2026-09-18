import type { BuildJobStatus, PublicationStatus } from '#/lib/types'

export type PublicationRow = {
  id: string
  status: PublicationStatus
  wasLive: boolean
  snapshotHash: string
  requestedBy: string | null
  requestedByName: string | null
  createdAt: string | Date
  deployedAt: string | Date | null
  job?: JobRow | null
}

export type JobRow = {
  id: string
  publicationId?: string
  status: BuildJobStatus
  attempts: number
  createdAt: string | Date
  startedAt?: string | Date | null
  finishedAt?: string | Date | null
  error: string | null
  logs: string | null
}
