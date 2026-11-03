import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
if (!process.argv[2])
  throw new Error('Usage: node analyze-profile.mjs <capture directory>')
const dir = resolve(process.argv[2]),
  p = JSON.parse(await readFile(`${dir}/cpu-profile.cpuprofile`)),
  meta = JSON.parse(await readFile(`${dir}/cpu-threads.json`))
const nodes = new Map(p.nodes.map((n) => [n.id, n])),
  weights = new Map(),
  groups = {}
for (let i = 0; i < p.samples.length; i++) {
  const id = p.samples[i],
    weight = p.timeDeltas?.[i] || 1000
  weights.set(id, (weights.get(id) || 0) + weight)
  const f = nodes.get(id).callFrame,
    key = f.url.includes('drizzle-orm')
      ? 'Drizzle/PostgreSQL client bundle'
      : f.functionName === '(idle)'
        ? 'Idle'
        : f.functionName === '(garbage collector)'
          ? 'Garbage collection'
          : f.url.includes('_ssr/ssr.mjs')
            ? 'Shared SSR/auth/serialization bundle'
            : 'Other runtime/application'
  groups[key] = (groups[key] || 0) + weight
}
const total = Object.values(groups).reduce((a, b) => a + b, 0)
const samples = meta.poolSamples?.filter((s) => s.poolAvailable) || [],
  first = samples[0],
  last = samples.at(-1)
const active = last?.elu?.active - first?.elu?.active,
  idle = last?.elu?.idle - first?.elu?.idle
const summary = {
  capturedAt: meta.capturedAt,
  durationSeconds: meta.durationSeconds,
  profileSamples: p.samples.length,
  eventLoopUtilization: Number.isFinite(active)
    ? active / (active + idle)
    : null,
  pool: {
    samples: samples.length,
    connections: [...new Set(samples.map((s) => s.total))],
    minIdle: Math.min(...samples.map((s) => s.idle)),
    waitingMin: Math.min(...samples.map((s) => s.waiting)),
    waitingMax: Math.max(...samples.map((s) => s.waiting)),
    waitingMean: samples.length
      ? samples.reduce((a, s) => a + s.waiting, 0) / samples.length
      : null,
  },
  groups: Object.fromEntries(
    Object.entries(groups).map(([k, v]) => [k, (100 * v) / total]),
  ),
  topFrames: p.nodes
    .map((n) => ({
      function: n.callFrame.functionName,
      url: n.callFrame.url,
      line: n.callFrame.lineNumber + 1,
      selfPercent: (100 * (weights.get(n.id) || 0)) / total,
    }))
    .sort((a, b) => b.selfPercent - a.selfPercent)
    .slice(0, 30),
  threads: meta.threads,
}
await writeFile(`${dir}/profile-summary.json`, JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary, null, 2))
