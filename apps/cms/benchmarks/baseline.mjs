import {
  ssh,
  sql,
  quote as q,
  app,
  service,
  workerService,
  refreshApp,
} from './remote.mjs'

export async function refreshSessions(fixtures) {
  const ids = fixtures.users.map((u) => q(u.sessionId)).join(',')
  const proofs = fixtures.users
    .filter((u) => u.role === 'admin')
    .map((u) => q(`local-mfa:${u.sessionId}`))
    .join(',')
  await sql(`UPDATE session SET created_at=now(),updated_at=now(),expires_at=now()+interval '24 hours' WHERE id IN (${ids});
UPDATE verification SET created_at=now(),updated_at=now(),expires_at=now()+interval '24 hours' WHERE id IN (${proofs});`)
}

export async function restoreBaseline(fixtures) {
  if (!/^load-[a-z0-9]+$/.test(fixtures.prefix))
    throw new Error('Invalid prefix')
  const snapshot = fixtures.baselinePath || `/tmp/areca-${fixtures.prefix}.dump`
  if (!/^\/tmp\/areca-load-[a-z0-9]+(?:-[a-z0-9]+)?\.dump$/.test(snapshot))
    throw new Error('Invalid baseline snapshot path')
  const workerReplicas = workerService
    ? Number(
        (
          await ssh(
            `docker service inspect --format '{{.Spec.Mode.Replicated.Replicas}}' ${workerService}`,
          )
        ).trim(),
      )
    : null
  if (
    workerService &&
    (!Number.isInteger(workerReplicas) || workerReplicas < 0)
  )
    throw new Error('Worker must be a replicated Swarm service')
  try {
    if (workerService)
      await ssh(`docker service scale ${workerService}=0 >/dev/null`)
    await ssh(
      `test -s ${snapshot} && ${service ? `docker service scale ${service}=0` : `docker stop ${app}`} >/dev/null`,
    )
    try {
      await ssh(
        `db=$(docker ps --filter ancestor=postgres:18 --format '{{.Names}}'); test -n "$db" && docker exec -i "$db" sh -c 'exec pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges --single-transaction --exit-on-error' < ${snapshot}`,
      )
      await refreshSessions(fixtures)
    } finally {
      await ssh(
        `${service ? `docker service scale ${service}=1` : `docker start ${app}`} >/dev/null`,
      )
      await refreshApp()
    }
  } finally {
    if (workerService)
      await ssh(
        `docker service scale ${workerService}=${workerReplicas} >/dev/null`,
      )
  }
  let healthy = false
  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000))
    try {
      const res = await fetch(`${fixtures.base}/api/health`, {
        signal: AbortSignal.timeout(5000),
      })
      if (res.ok) {
        healthy = true
        break
      }
    } catch {}
  }
  if (!healthy) throw new Error('Health did not recover after baseline restore')
}
