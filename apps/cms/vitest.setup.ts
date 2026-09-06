import { config } from 'dotenv'

config({ path: ['.env.local', '.env'] })
process.env.WORKER_ENABLED = 'false'
