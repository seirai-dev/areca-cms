import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getManifest } from '../src/lib/content.ts'

// The static build has no server, so `/api/health` is a file written at build
// time. It carries the publication this build was made from, which is what the
// CMS health check compares after a release. Same body as the Node route.
const publicDir = join(process.cwd(), '.output/public')
const { publicationId } = getManifest()
const filePath = join(publicDir, 'api/health')

mkdirSync(join(publicDir, 'api'), { recursive: true })
writeFileSync(filePath, `${JSON.stringify({ ok: true, publicationId })}\n`)
console.log(`Wrote ${filePath} (publication ${publicationId})`)
