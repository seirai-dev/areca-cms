import { config } from 'dotenv'
import { Client } from 'pg'

import {
  MAX_WORKERS,
  integrationEnabled,
  templateDatabaseName,
  withDatabase,
  workerDatabaseName,
} from './vitest.worker-isolation.ts'

// Same files and precedence as vitest.setup.ts, so both sides see the same
// DATABASE_URL.
config({ path: ['.env.local', '.env'] })

/**
 * Runs once in the main process before any worker starts. Creates one clone
 * of the migrated test database per worker (see vitest.worker-isolation.ts).
 * Cloning happens here, serially, because CREATE DATABASE ... TEMPLATE fails
 * while another session is connected to the template.
 */
export default async function setupIntegrationDatabases() {
  if (!integrationEnabled(process.env)) return

  const templateUrl = process.env.DATABASE_URL as string
  const templateName = templateDatabaseName(templateUrl)
  const admin = new Client({
    connectionString: withDatabase(templateUrl, 'postgres'),
  })
  await admin.connect()
  try {
    for (let workerId = 1; workerId <= MAX_WORKERS; workerId++) {
      const name = workerDatabaseName(templateName, workerId)
      // Names are validated above (letters, digits, underscore), so quoting is enough.
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
      await admin.query(`CREATE DATABASE "${name}" TEMPLATE "${templateName}"`)
    }
  } finally {
    await admin.end()
  }
}
