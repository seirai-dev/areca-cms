import { createReadStream } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { createGunzip, constants } from 'node:zlib'
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'
const dir = resolve(process.argv[2] || '')
if (!process.argv[2])
  throw new Error('Usage: node report.mjs <tier-results-directory>')
const live = process.argv.includes('--live')
let summary
try {
  summary = JSON.parse(await readFile(`${dir}/summary.json`))
} catch (error) {
  if (!live) throw error
  summary = { target: Number(dir.split(/[\\/]/).at(-1)), measure: 600 }
}
const latency = [],
  byOperation = new Map(),
  minutes = new Map()
let failures = 0,
  count = 0
const failureKinds = {},
  firstEvents = {}
let firstTime, lastTime
const lines = createInterface({
  input: createReadStream(`${dir}/samples.json.gz`).pipe(
    createGunzip(live ? { finishFlush: constants.Z_SYNC_FLUSH } : {}),
  ),
  crlfDelay: Infinity,
})
function bucket(map, key) {
  if (!map.has(key)) map.set(key, { latency: [], failures: 0, requests: 0 })
  return map.get(key)
}
for await (const line of lines) {
  let row
  try {
    row = JSON.parse(line)
  } catch {
    continue
  }
  if (
    row.type !== 'Point' ||
    !['bench_latency', 'bench_failure'].includes(row.metric)
  )
    continue
  const op = bucket(byOperation, row.data.tags?.operation || 'unknown')
  firstTime ??= row.data.time
  lastTime = row.data.time
  const minute = bucket(
    minutes,
    new Date(row.data.time).toISOString().slice(0, 16),
  )
  if (row.metric === 'bench_latency') {
    latency.push(row.data.value)
    op.latency.push(row.data.value)
    minute.latency.push(row.data.value)
    if (row.data.value >= 500 && !firstEvents.over500)
      firstEvents.over500 = {
        at: row.data.time,
        operation: row.data.tags?.operation,
        ms: row.data.value,
      }
    if (row.data.value >= 1000 && !firstEvents.over1000)
      firstEvents.over1000 = {
        at: row.data.time,
        operation: row.data.tags?.operation,
        ms: row.data.value,
      }
  } else {
    failures += row.data.value
    count++
    op.failures += row.data.value
    op.requests++
    minute.failures += row.data.value
    minute.requests++
    if (row.data.value) {
      const key = `${row.data.tags?.kind || 'unknown'}:${row.data.tags?.status || 'unknown'}`
      failureKinds[key] = (failureKinds[key] || 0) + row.data.value
      firstEvents.failed ??= {
        at: row.data.time,
        operation: row.data.tags?.operation,
        kind: key,
      }
    }
  }
}
function describe(values) {
  values.sort((a, b) => a - b)
  const p = (n) => {
    if (!values.length) return null
    const at = (values.length - 1) * n
    return (
      values[Math.floor(at)] +
      (values[Math.ceil(at)] - values[Math.floor(at)]) * (at % 1)
    )
  }
  return {
    samples: values.length,
    p95: p(0.95),
    p99: p(0.99),
    max: values.at(-1) ?? null,
  }
}
const stats = describe(latency)
const report = {
  target: summary.target,
  requests: count,
  rps: count / summary.measure,
  failureRate: count ? failures / count : null,
  ...stats,
  firstMeasuredRequest: firstTime,
  lastMeasuredRequest: lastTime,
  firstEvents,
  failureKinds,
  requestThresholdsPass:
    count >= 1000 &&
    stats.p95 < 500 &&
    stats.p99 < 1000 &&
    failures / count < 0.01,
  journeyFailureRate: summary.metrics?.journey_failure?.values?.rate ?? null,
  operations: Object.fromEntries(
    [...byOperation].map(([name, v]) => [
      name,
      {
        ...describe(v.latency),
        requests: v.requests,
        failureRate: v.requests ? v.failures / v.requests : null,
      },
    ]),
  ),
  minutes: Object.fromEntries(
    [...minutes].map(([name, v]) => [
      name,
      {
        ...describe(v.latency),
        requests: v.requests,
        failureRate: v.requests ? v.failures / v.requests : null,
      },
    ]),
  ),
}
const resources = (await readFile(`${dir}/resources.jsonl`, 'utf8'))
  .trim()
  .split('\n')
  .map((l) => {
    try {
      return JSON.parse(l)
    } catch {
      return {}
    }
  })
  .filter((r) => r.available_mb !== undefined)
  .filter(
    (r) =>
      !firstTime ||
      (r.at >= Date.parse(firstTime) / 1000 &&
        r.at <= Date.parse(lastTime) / 1000),
  )
report.resources = {
  scope: firstTime ? 'measured request window' : 'ramp/settling',
  samples: resources.length,
  minAvailableMB: Math.min(...resources.map((r) => r.available_mb)),
  maxCpuPercent: Math.max(...resources.map((r) => r.cpu_percent)),
  minDiskFreeGB: Math.min(...resources.map((r) => r.disk_free_gb)),
  oom: resources.some((r) => r.states?.some((s) => s.oom)),
}
report.resources.components = {}
for (const row of resources)
  for (const c of row.containers || []) {
    const key = c.Name?.startsWith('areca-cms-app-')
      ? 'cms'
      : c.Name?.startsWith('areca-cms-worker-')
        ? 'worker'
        : c.Name?.startsWith('areca-cms-db-')
          ? 'postgres'
          : c.Name?.startsWith('areca-cms-redis-')
            ? 'redis'
            : c.Name?.startsWith('areca-cms-s3-')
              ? 'rustfs'
              : 'proxy'
    const previous = (report.resources.components[key] ??= {
      samples: 0,
      cpuSum: 0,
      maxCpuPercent: 0,
      maxMemoryMiB: 0,
    })
    const cpu = Number.parseFloat(c.CPUPerc) || 0
    previous.samples++
    previous.cpuSum += cpu
    previous.maxCpuPercent = Math.max(previous.maxCpuPercent, cpu)
    const match = c.MemUsage?.match(/([\d.]+)([KMGT]?i?B)/)
    if (match) {
      const units = {
        B: 1 / 1048576,
        kB: 1 / 1024,
        KB: 1 / 1024,
        KiB: 1 / 1024,
        MB: 1,
        MiB: 1,
        GB: 1024,
        GiB: 1024,
      }
      previous.maxMemoryMiB = Math.max(
        previous.maxMemoryMiB,
        Number(match[1]) * (units[match[2]] || 1),
      )
    }
  }
for (const c of Object.values(report.resources.components)) {
  c.avgCpuPercent = c.cpuSum / c.samples
  delete c.cpuSum
}
const postgres = resources.flatMap((r) => r.postgres || [])
report.resources.postgres = {
  maxConnections: Math.max(0, ...postgres.map((p) => p.connections || 0)),
  maxActive: Math.max(0, ...postgres.map((p) => p.active || 0)),
  maxLockWaiters: Math.max(0, ...postgres.map((p) => p.waiting_lock || 0)),
  maxOldestQuerySeconds: Math.max(
    0,
    ...postgres.map((p) => p.oldest_active_seconds || 0),
  ),
}
const dbCounters = postgres.filter((p) => p.commits !== undefined)
report.resources.postgresCounters = {}
if (dbCounters.length)
  for (const key of [
    'commits',
    'rollbacks',
    'deadlocks',
    'temp_bytes',
    'blocks_read',
    'blocks_hit',
  ])
    report.resources.postgresCounters[key] =
      dbCounters.at(-1)[key] - dbCounters[0][key]
for (const field of [
  'cpu_percent',
  'cpu_steal_percent',
  'cpu_iowait_percent',
]) {
  const values = resources.map((r) => r[field]).filter(Number.isFinite)
  report.resources[field] = {
    avg: values.length
      ? values.reduce((a, b) => a + b, 0) / values.length
      : null,
    max: values.length ? Math.max(...values) : null,
  }
}
const probes = resources.filter((r) => r.probes?.redis)
const appMetrics = new Map()
for (const row of resources)
  for (const sample of row.probes?.metrics?.samples || []) {
    if (!Number.isFinite(sample.value)) continue
    const key = `${sample.name}${sample.labels || ''}`
    if (!appMetrics.has(key)) appMetrics.set(key, [])
    appMetrics.get(key).push(sample.value)
  }
report.resources.appMetrics = Object.fromEntries(
  [...appMetrics].map(([key, values]) => [
    key,
    {
      ...describe(values),
      min: Math.min(...values),
      avg: values.reduce((sum, value) => sum + value, 0) / values.length,
    },
  ]),
)
for (const component of ['redis', 's3', 'cms']) {
  const points = resources.flatMap((r) =>
    r.probes?.[component] ? [r.probes[component]] : [],
  )
  report.resources[`${component}Probes`] = {
    ...describe(points.map((p) => p.ms).filter(Number.isFinite)),
    errors: points.filter((p) => p.error || p.status >= 400).length,
  }
}
if (probes.length) {
  const first = probes[0].probes.redis,
    last = probes.at(-1).probes.redis
  report.resources.redisCounters = {}
  for (const key of [
    'rejected_connections',
    'evicted_keys',
    'total_error_replies',
    'total_commands_processed',
  ])
    report.resources.redisCounters[key] = (last[key] || 0) - (first[key] || 0)
}
if (!live) {
  const timings = new Map()
  const detailLines = createInterface({
    input: createReadStream(`${dir}/samples.json.gz`).pipe(createGunzip()),
    crlfDelay: Infinity,
  })
  for await (const line of detailLines) {
    const point = JSON.parse(line)
    if (
      point.type !== 'Point' ||
      !['http_req_waiting', 'http_req_sending', 'http_req_receiving'].includes(
        point.metric,
      )
    )
      continue
    const time = Date.parse(point.data.time)
    if (time < Date.parse(firstTime) || time > Date.parse(lastTime)) continue
    const name = point.data.tags?.name || 'unknown'
    if (!timings.has(name)) timings.set(name, {})
    const fields = timings.get(name)
    ;(fields[point.metric] ??= []).push(point.data.value)
  }
  report.requestTimings = Object.fromEntries(
    [...timings].map(([name, fields]) => [
      name,
      Object.fromEntries(
        Object.entries(fields).map(([key, values]) => [
          key,
          {
            ...describe(values),
            avg: values.reduce((a, b) => a + b, 0) / values.length,
          },
        ]),
      ),
    ]),
  )
  await writeFile(`${dir}/report.json`, JSON.stringify(report, null, 2))
}
console.log(
  JSON.stringify(
    live
      ? {
          target: report.target,
          requests: report.requests,
          p95: report.p95,
          p99: report.p99,
          failureRate: report.failureRate,
          firstEvents,
          failureKinds,
          resources: report.resources,
        }
      : report,
    null,
    2,
  ),
)
