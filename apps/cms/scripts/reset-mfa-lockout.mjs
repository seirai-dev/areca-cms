import pg from 'pg'
import { config } from 'dotenv'
import { parseMfaRecoveryArgs, resetMfaLockout } from './lib/mfa-recovery.mjs'

const email = parseMfaRecoveryArgs(process.argv.slice(2))
config({ path: ['.env.local', '.env'], quiet: true })
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
try {
  await client.connect()
  await resetMfaLockout(client, email)
  console.log(
    'Failed-code lockout cleared. Two-factor authentication remains required.',
  )
} finally {
  await client.end()
}
