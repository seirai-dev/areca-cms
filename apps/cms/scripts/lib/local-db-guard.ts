/**
 * Refuses destructive demo tooling (`pnpm db:demo`) unless the database and the
 * object store are on this machine or the local docker network. Run on its own
 * it checks the current environment; `demo-seed.ts` imports it as a second guard.
 */
const LOCAL_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
  'postgres',
  'minio',
  'rustfs',
  'host.docker.internal',
])

export function assertLocalDevDatabase(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'Refusing to run the demo tooling with NODE_ENV=production.',
    )
  }
  const hosts = [
    ['DATABASE_URL', env.DATABASE_URL],
    ['S3_ENDPOINT', env.S3_ENDPOINT],
  ] as const
  for (const [name, value] of hosts) {
    if (!value) throw new Error(`${name} is not set.`)
    let hostname: string
    try {
      hostname = new URL(value).hostname
    } catch {
      throw new Error(`${name} is not a valid URL.`)
    }
    if (!LOCAL_HOSTS.has(hostname)) {
      throw new Error(
        `Refusing to run the demo tooling: ${name} points at "${hostname}", which is not a local host (${[...LOCAL_HOSTS].join(', ')}).`,
      )
    }
  }
}

if (process.argv[1]?.endsWith('local-db-guard.ts')) {
  assertLocalDevDatabase()
  console.log('Local dev database check passed.')
}
