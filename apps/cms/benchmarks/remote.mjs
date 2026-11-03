import { spawn } from 'node:child_process'
export const host = process.env.BENCH_SSH
if (!host) throw new Error('Set BENCH_SSH to the disposable Docker host')
export const service = process.env.BENCH_SERVICE || null
export const workerService = process.env.BENCH_WORKER_SERVICE || null
if (workerService && !/^[a-zA-Z0-9_.-]+$/.test(workerService))
  throw new Error('Invalid worker service name')
if (workerService && workerService === service)
  throw new Error('Web and worker service names must differ')
export let app = process.env.BENCH_CONTAINER || 'unconfigured'
if (!service && app === 'unconfigured')
  throw new Error('Set BENCH_SERVICE (Swarm) or BENCH_CONTAINER (Compose)')
if (service && !/^[a-zA-Z0-9_.-]+$/.test(service))
  throw new Error('Invalid service name')
if (!/^[a-zA-Z0-9_.-]+$/.test(app)) throw new Error('Invalid container name')
export function ssh(command, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', host, command],
      { windowsHide: true },
    )
    const out = [],
      err = []
    child.stdout.on('data', (b) => out.push(b))
    child.stderr.on('data', (b) => err.push(b))
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0
        ? resolve(Buffer.concat(out).toString())
        : reject(
            new Error(
              `SSH command failed (${code}): ${Buffer.concat(err).toString().slice(0, 1000)}`,
            ),
          ),
    )
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}
export function sql(query) {
  return ssh(
    `db=$(docker ps --filter ancestor=postgres:18 --format '{{.Names}}'); test -n "$db" && docker exec -i "$db" sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -Atq'`,
    query,
  )
}
export const quote = (value) => `'${String(value).replaceAll("'", "''")}'`
export async function refreshApp() {
  if (!service) return app
  for (let i = 0; i < 30; i++) {
    const names = (
      await ssh(
        `docker ps --filter label=com.docker.swarm.service.name=${service} --format '{{.Names}}'`,
      )
    )
      .trim()
      .split('\n')
      .filter(Boolean)
    if (names.length === 1) {
      app = names[0]
      return app
    }
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  throw new Error('Expected exactly one running CMS service task')
}
if (service) await refreshApp()
