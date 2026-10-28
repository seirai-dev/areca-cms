import { config } from 'dotenv'

import { isolateWorkerEnvironment } from './vitest.worker-isolation.ts'

config({ path: ['.env.local', '.env'] })
process.env.WORKER_ENABLED = 'false'
// Must run before any test file imports `#/env` or `#/db`.
isolateWorkerEnvironment()
