import { randomUUID } from 'node:crypto'

export function parseMfaRecoveryArgs(args) {
  if (
    args.length !== 3 ||
    args[0] !== '--email' ||
    args[2] !== '--confirm' ||
    !args[1].includes('@')
  ) {
    throw new Error(
      'Usage: node scripts/reset-mfa-lockout.mjs --email admin@example.com --confirm',
    )
  }
  return args[1].trim().toLowerCase()
}

/** Operator access is the recovery authority; only failed-attempt rows change. */
export async function resetMfaLockout(client, email) {
  await client.query('BEGIN')
  try {
    const result = await client.query(
      'SELECT id, is_agency_admin FROM "user" WHERE lower(email) = $1',
      [email],
    )
    const target = result.rows[0]
    if (!target?.is_agency_admin) throw new Error('Agency admin not found.')
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`local-factor:${target.id}`],
    )
    await client.query('DELETE FROM verification WHERE identifier = $1', [
      `step-up-failures:${target.id}`,
    ])
    await client.query(
      `INSERT INTO audit_log (id, organization_id, actor_id, action, target_type, target_id, meta)
      VALUES ($1, NULL, NULL, 'security.factor_lockout_reset', 'user', $2, $3::jsonb)`,
      [randomUUID(), target.id, JSON.stringify({ via: 'operator-cli', email })],
    )
    await client.query('COMMIT')
    return target.id
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}
