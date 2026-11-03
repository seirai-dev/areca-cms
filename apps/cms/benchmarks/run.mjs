import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { ssh, app, host } from './remote.mjs'
import { restoreBaseline, refreshSessions } from './baseline.mjs'

// This is deliberately separate from permission to prepare fixtures/preflight.
if (process.env.ARECA_RUN_LOAD !== 'YES')
  throw new Error(
    'Review README.md first; set ARECA_RUN_LOAD=YES only after approval',
  )
const dir = fileURLToPath(new URL('./.local/', import.meta.url))
const fixtures = JSON.parse(await readFile(`${dir}/fixtures.json`))
const deployedImage = (
  await ssh(`docker inspect --format '{{.Config.Image}}' ${app}`)
).trim()
const deployedImageId = (
  await ssh(`docker inspect --format '{{.Image}}' ${app}`)
).trim()
if (fixtures.imageId && fixtures.imageId !== deployedImageId)
  throw new Error(
    'Deployed image content changed; refresh deployment mapping and baseline before testing',
  )
if (fixtures.image && deployedImage !== fixtures.image)
  throw new Error(
    'Deployed image changed; prepare a new manifest and baseline before testing',
  )
const preflight = JSON.parse(await readFile(`${dir}/preflight.json`))
if (!preflight.passed.includes('passwordLogin'))
  throw new Error('Run preflight first')
if (!/^load-[a-z0-9]+$/.test(fixtures.prefix)) throw new Error('Invalid prefix')
const levels = (
  process.env.BENCH_LEVELS || '10,25,50,100,200,500,1000,1500,2000'
)
  .split(',')
  .map(Number)
if (
  levels.some((n) => !Number.isInteger(n) || n < 1 || n > fixtures.users.length)
)
  throw new Error('Invalid tiers')
async function findExe(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.name === 'k6.exe' || entry.name === 'k6')
      return `${path}/${entry.name}`
    if (entry.isDirectory()) {
      const found = await findExe(`${path}/${entry.name}`)
      if (found) return found
    }
  }
}
const k6 = process.env.K6_BIN || (await findExe(`${dir}/tools`))
if (!k6) throw new Error('Set K6_BIN to k6 executable')
const runDir = `${dir}/results-${new Date().toISOString().replaceAll(':', '-')}`
await mkdir(runDir, { recursive: true })
await writeFile(
  `${runDir}/run.json`,
  JSON.stringify(
    {
      started: new Date().toISOString(),
      levels,
      prefix: fixtures.prefix,
      image: deployedImage,
      imageId: deployedImageId,
      base: fixtures.base,
      baselinePath: fixtures.baselinePath,
      workload: {
        sha256: createHash('sha256')
          .update(await readFile(`${dir}/workload.mjs`))
          .digest('hex'),
        seed: process.env.BENCH_SEED || '12345',
        batchedCounts: Boolean(
          JSON.parse(await readFile(`${dir}/manifest.json`)).listEntryCountsFn,
        ),
      },
      purpose: process.env.BENCH_PURPOSE || 'capacity',
      generator: {
        cpu: os.cpus()[0].model,
        cores: os.cpus().length,
        totalMemory: os.totalmem(),
      },
      policy:
        'stop on failed tier or resource guard; restore private baseline before every tier',
    },
    null,
    2,
  ),
)
const reports = []
for (const target of levels) {
  console.log(
    `Preparing ${target} users: restore baseline, refresh synthetic sessions, restart app, cool down.`,
  )
  // Only the disposable CMS database is restored. The original account is in
  // the snapshot. S3 test blobs remain on disk and are reported as retained data.
  await restoreBaseline(fixtures)
  const tierImageId = (
    await ssh(`docker inspect --format '{{.Image}}' ${app}`)
  ).trim()
  if (tierImageId !== deployedImageId)
    throw new Error(
      'CMS image changed while resetting the baseline; refusing mixed-build results',
    )
  await new Promise((resolve) => setTimeout(resolve, 60000))
  await refreshSessions(fixtures)
  const tierDir = `${runDir}/${target}`
  await mkdir(tierDir)
  const tierStarted = new Date().toISOString()
  const initialStates = (
    await ssh(
      `docker inspect --format '{"name":{{json .Name}},"restarts":{{.RestartCount}}}' $(docker ps -q)`,
    )
  )
    .trim()
    .split('\n')
    .map(JSON.parse)
  const resources = createWriteStream(`${tierDir}/resources.jsonl`)
  const generator = createWriteStream(`${tierDir}/generator.jsonl`)
  const consoleLog = createWriteStream(`${tierDir}/k6.log`)
  let guard = null,
    lastSample = Date.now(),
    lowMemory = 0,
    monitorErrors = 0,
    baselineStates = Object.fromEntries(
      initialStates.map((s) => [s.name, s.restarts]),
    ),
    buffer = ''
  const monitor = spawn('ssh', ['-o', 'BatchMode=yes', host, 'python3 -u -'], {
    windowsHide: true,
  })
  const child = spawn(
    k6,
    [
      'run',
      '--no-color',
      '--quiet',
      '--out',
      `json=${tierDir}/samples.json.gz`,
      `${dir}/workload.mjs`,
    ],
    {
      cwd: dir,
      windowsHide: true,
      env: {
        ...process.env,
        BENCH_VUS: String(target),
        BENCH_SUMMARY: `${tierDir}/summary.json`,
      },
    },
  )
  const stop = (reason) => {
    if (!guard) {
      guard = reason
      console.error(`STOP: ${reason}`)
      child.kill()
    }
  }
  const interrupt = () => stop('User interrupted benchmark')
  process.once('SIGINT', interrupt)
  monitor.on('error', () => stop('SSH monitor failed to start'))
  monitor.on('close', () => {
    if (child.exitCode === null) stop('SSH resource monitor disconnected')
  })
  monitor.stderr.on('data', (b) => {
    if (!resources.writableEnded)
      resources.write(
        JSON.stringify({ monitorStderr: String(b).slice(0, 200) }) + '\n',
      )
  })
  monitor.stdout.on('data', (chunk) => {
    if (resources.writableEnded) return
    resources.write(chunk)
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop()
    for (const line of lines)
      try {
        const sample = JSON.parse(line)
        lastSample = Date.now()
        if (sample.error) {
          if (++monitorErrors >= 3)
            stop('Three consecutive failed resource samples')
          continue
        }
        monitorErrors = 0
        if (!baselineStates)
          baselineStates = Object.fromEntries(
            sample.states.map((s) => [s.name, s.restarts]),
          )
        if (
          sample.states.some(
            (s) =>
              !Object.hasOwn(baselineStates, s.name) ||
              s.oom ||
              s.status !== 'running' ||
              s.restarts > (baselineStates[s.name] ?? 0),
          )
        )
          stop('Container OOM, replacement, restart, or stopped service')
        if (sample.states.length < 5)
          stop(
            'Expected CMS, Postgres, Redis, RustFS and proxy containers missing',
          )
        lowMemory = sample.available_mb < 200 ? lowMemory + 1 : 0
        if (lowMemory >= 3)
          stop('Available VPS memory below 200 MiB for three samples')
        if (sample.disk_free_gb < 2) stop('VPS disk free below 2 GiB')
      } catch {
        stop('Invalid monitor output')
      }
  })
  monitor.stdin.on('error', () => {})
  const probeSource = await readFile(
    new URL('./probe.cjs', import.meta.url),
    'utf8',
  )
  const monitorSource = (
    await readFile(new URL('./monitor.py', import.meta.url), 'utf8')
  ).replace(
    '# PROBE_SOURCE_PLACEHOLDER',
    `PROBE_SOURCE = __import__('base64').b64decode('${Buffer.from(probeSource).toString('base64')}').decode()`,
  )
  monitor.stdin.end(monitorSource)
  let previousCpu = 0,
    previousTime = Date.now()
  const timer = setInterval(async () => {
    const now = Date.now()
    if (now - lastSample > 20000)
      stop('No valid resource sample for 20 seconds')
    const childCpu = await generatorUsage(child.pid)
    const elapsed = now - previousTime
    generator.write(
      JSON.stringify({
        at: new Date().toISOString(),
        freeMemory: os.freemem(),
        ...childCpu,
        cpuPercent:
          childCpu.cpuMs === undefined
            ? null
            : (100 * (childCpu.cpuMs - previousCpu)) / elapsed,
      }) + '\n',
    )
    if (childCpu.cpuMs !== undefined) previousCpu = childCpu.cpuMs
    previousTime = now
  }, 5000)
  child.stdout.pipe(consoleLog, { end: false })
  child.stderr.pipe(consoleLog, { end: false })
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })
  clearInterval(timer)
  process.off('SIGINT', interrupt)
  monitor.kill()
  resources.end()
  generator.end()
  consoleLog.end()
  try {
    const logs = await ssh(
      `for name in $(docker ps -a --format '{{.Names}}'); do case "$name" in areca-cms-*) printf '\\nCONTAINER %s\\n' "$name"; docker logs --timestamps --since '${tierStarted}' --tail 500 "$name" 2>&1;; esac; done`,
    )
    await writeFile(`${tierDir}/service-logs.txt`, logs)
  } catch (error) {
    await writeFile(`${tierDir}/service-logs-error.txt`, error.message)
  }
  let summary
  try {
    summary = JSON.parse(await readFile(`${tierDir}/summary.json`))
  } catch {}
  const report = {
    target,
    exitCode,
    guard,
    started: tierStarted,
    finished: new Date().toISOString(),
    summary: summary?.metrics ?? null,
  }
  reports.push(report)
  await writeFile(`${runDir}/tiers.json`, JSON.stringify(reports, null, 2))
  console.log(
    `${target} users: ${guard || (exitCode === 0 ? 'PASS' : 'FAIL or insufficient samples')}; results ${tierDir}`,
  )
  if (guard || exitCode !== 0) break
}
console.log(
  `Results saved to ${runDir}. Higher tiers after a failure remain untested.`,
)

async function generatorUsage(pid) {
  if (process.platform !== 'win32')
    return {
      note: 'Use OS process metrics for generator saturation on this platform',
    }
  return new Promise((resolve) => {
    const probe = spawn(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `$p=Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue; if($p){@{cpuMs=$p.TotalProcessorTime.TotalMilliseconds;workingSet=$p.WorkingSet64;threads=$p.Threads.Count}|ConvertTo-Json -Compress}`,
      ],
      { windowsHide: true },
    )
    let out = ''
    probe.stdout.on('data', (b) => (out += b))
    probe.on('error', () => resolve({}))
    probe.on('close', () => {
      try {
        resolve(JSON.parse(out))
      } catch {
        resolve({})
      }
    })
  })
}
