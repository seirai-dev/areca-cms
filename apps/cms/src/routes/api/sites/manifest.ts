import { createFileRoute } from '@tanstack/react-router'
import '@tanstack/react-start'
import { z } from 'zod'

import type { FieldType, SiteManifest } from '#/lib/types'
import { listCollections, syncManifest } from '#/server/content/collections'
import { authenticateSite } from '#/server/content/site-auth'

const fieldTypes = [
  'text',
  'textarea',
  'richtext',
  'image',
  'date',
  'datetime',
  'select',
  'reference',
  'slug',
  'boolean',
  'number',
  'url',
] as const satisfies readonly FieldType[]

const fieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(fieldTypes),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  collection: z.string().optional(),
  description: z.string().optional(),
  after: z.string().min(1).optional(),
})

const manifestSchema = z.object({
  collections: z.record(
    z.string(),
    z.object({
      route: z.string().min(1),
      label: z.string().optional(),
      fields: z.array(fieldSchema),
    }),
  ),
})

export async function getSitesManifest(request: Request) {
  const site = await authenticateSite(request)
  if (!site) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rows = await listCollections(site.id, { enabledOnly: true })
  const collections: SiteManifest['collections'] = {}
  for (const row of rows) {
    collections[row.key] = {
      route: row.routePattern,
      label: row.label,
      fields: row.fields,
    }
  }

  return Response.json({ collections } satisfies SiteManifest)
}

export async function postSitesManifest(request: Request) {
  const site = await authenticateSite(request)
  if (!site) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json(
      { error: 'Invalid body', issues: [{ message: 'Expected JSON' }] },
      { status: 400 },
    )
  }

  const parsed = manifestSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid body', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  await syncManifest(site.id, parsed.data)
  return Response.json({ ok: true as const })
}

export const Route = createFileRoute('/api/sites/manifest')({
  server: {
    handlers: {
      GET: ({ request }) => getSitesManifest(request),
      POST: ({ request }) => postSitesManifest(request),
    },
  },
})
