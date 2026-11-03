import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
if (!process.argv[2])
  throw new Error('Usage: node render-results.mjs <formal run directory>')
const run = resolve(process.argv[2]),
  out = process.argv[3]
    ? pathToFileURL(resolve(process.argv[3]) + '/')
    : new URL('./results/', import.meta.url)
const metadata = JSON.parse(await readFile(`${run}/run.json`)),
  tiers = JSON.parse(await readFile(`${run}/tiers.json`))
const reports = []
for (const tier of tiers)
  reports.push({
    ...JSON.parse(await readFile(`${run}/${tier.target}/report.json`)),
    exitCode: tier.exitCode,
    guard: tier.guard,
  })
const untested = metadata.levels.filter(
  (n) => !reports.some((r) => r.target === n),
)
const data = {
  generatedAt: new Date().toISOString(),
  environment: {
    image: metadata.image,
    generator: metadata.generator,
    vcpus: 2,
    memoryGiB: 3814.6796875 / 1024,
  },
  totalMeasuredRequests: reports.reduce((a, r) => a + r.requests, 0),
  reports,
  untested,
}
await mkdir(out, { recursive: true })
await writeFile(
  new URL('capacity-results.json', out),
  JSON.stringify(data, null, 2),
)
const chart = {
  lastTarget: reports.at(-1).target,
  failureRate: reports.at(-1).failureRate,
  tiers: metadata.levels.map((target) => {
    const r = reports.find((r) => r.target === target)
    return r
      ? {
          target,
          p95: r.p95,
          p99: r.p99,
          status: r.exitCode === 0 ? 'PASS' : 'FAIL',
        }
      : { target, status: 'UNTESTED' }
  }),
  components: reports.at(-1).resources.components,
}
if (process.argv[4]) {
  const previous = JSON.parse(await readFile(resolve(process.argv[4])))
  chart.tiers.find((t) => t.target === previous.target).label =
    `Now ${previous.target}`
  chart.tiers.unshift({
    target: previous.target,
    label: `Earlier ${previous.target}`,
    p95: previous.p95,
    p99: previous.p99,
    status: previous.requestThresholdsPass ? 'PASS' : 'FAIL',
  })
}
const template = await readFile(
  new URL('./chart-template.html', import.meta.url),
  'utf8',
)
await writeFile(
  new URL('capacity-summary.html', out),
  template.replace('__BENCH_DATA__', JSON.stringify(chart)),
)
console.log(`Saved sanitized results and charts to ${out.pathname}`)
