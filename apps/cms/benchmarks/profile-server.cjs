// Stream into the CMS container only during a separate diagnostic replay.
// SIGUSR1 enables the inspector on container loopback, not the public host.
const fs = require('node:fs')
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function main() {
  if (process.env.BENCH_CPU_PROFILE !== 'YES')
    throw new Error('Explicit diagnostic opt-in required')
  const pid = fs
    .readdirSync('/proc')
    .filter((p) => /^\d+$/.test(p))
    .find((p) => {
      try {
        return fs
          .readFileSync(`/proc/${p}/cmdline`, 'utf8')
          .split('\0')
          .some((arg) => arg.endsWith('/.output/server/index.mjs'))
      } catch {
        return false
      }
    })
  if (!pid) throw new Error('CMS server child process not found')
  const threadTimes = () => {
    const out = {}
    for (const tid of fs.readdirSync(`/proc/${pid}/task`))
      try {
        const stat = fs
          .readFileSync(`/proc/${pid}/task/${tid}/stat`, 'utf8')
          .trim()
          .match(/^\d+ \((.*)\) (.*)$/)
        const fields = stat[2].split(' ')
        out[tid] = {
          name: stat[1],
          ticks: Number(fields[11]) + Number(fields[12]),
        }
      } catch {}
    return out
  }
  process.kill(Number(pid), 'SIGUSR1')
  let targets
  for (let i = 0; i < 30; i++) {
    try {
      targets = await (await fetch('http://127.0.0.1:9229/json/list')).json()
      break
    } catch {
      await wait(100)
    }
  }
  const target = targets?.find((t) =>
    t.url?.endsWith('/.output/server/index.mjs'),
  )
  if (!target) throw new Error('Inspector target does not match CMS server')
  const ws = new WebSocket(target.webSocketDebuggerUrl),
    pending = new Map()
  let serial = 0
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(String(event.data))
    if (!msg.id) return
    const p = pending.get(msg.id)
    if (p) {
      pending.delete(msg.id)
      clearTimeout(p.timer)
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
    }
  })
  ws.addEventListener('close', () => {
    for (const p of pending.values()) {
      clearTimeout(p.timer)
      p.reject(new Error('Inspector disconnected'))
    }
    pending.clear()
  })
  const post = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++serial
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`Inspector timeout: ${method}`))
      }, 10000)
      pending.set(id, { resolve, reject, timer })
      ws.send(JSON.stringify({ id, method, params }))
    })
  try {
    const evaluate = async (expression) => {
      const response = await post('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      })
      return response.exceptionDetails
        ? { error: response.exceptionDetails.text }
        : response.result?.value
    }
    const dbUrl = require('node:url').pathToFileURL(
      `${process.cwd()}/.output/server/_ssr/ssr.mjs`,
    ).href
    const expression = `(()=>{let p=globalThis.__arecaBenchmarkPool,error;if(!p)try{const m=process.getBuiltinModule('node:module').createRequire(process.cwd()+'/bench-profile.cjs')(${JSON.stringify(dbUrl.replace('file://', ''))});p=m.db?.$client||m.pool||m.db?.session?.client;globalThis.__arecaBenchmarkPool=p}catch(e){error=e.message}return {poolAvailable:Boolean(p),poolError:error,total:p?.totalCount,idle:p?.idleCount,waiting:p?.waitingCount,memory:process.memoryUsage(),elu:process.getBuiltinModule('node:perf_hooks').performance.eventLoopUtilization(),cpu:process.cpuUsage()}})()`
    const poolSamples = []
    let sampling = false
    const sample = async () => {
      if (sampling) return
      sampling = true
      try {
        poolSamples.push({
          at: new Date().toISOString(),
          ...(await evaluate(expression)),
        })
      } catch (error) {
        poolSamples.push({ error: error.message })
      } finally {
        sampling = false
      }
    }
    await sample()
    await post('Profiler.enable')
    await post('Profiler.setSamplingInterval', { interval: 1000 })
    const before = threadTimes(),
      started = Date.now()
    await post('Profiler.start')
    const timer = setInterval(sample, 1000)
    await wait(Number(process.env.BENCH_PROFILE_SECONDS || 30) * 1000)
    clearInterval(timer)
    await sample()
    const { profile } = await post('Profiler.stop'),
      after = threadTimes()
    const threads = Object.entries(after)
      .map(([tid, t]) => ({
        tid,
        name: t.name,
        cpuSeconds: (t.ticks - (before[tid]?.ticks || t.ticks)) / 100,
      }))
      .sort((a, b) => b.cpuSeconds - a.cpuSeconds)
    console.log(
      JSON.stringify({
        capturedAt: new Date().toISOString(),
        durationSeconds: (Date.now() - started) / 1000,
        serverPid: Number(pid),
        clockTicksPerSecond: 100,
        threads,
        poolSamples,
        profile,
      }),
    )
  } finally {
    try {
      await post('Runtime.evaluate', {
        expression:
          "delete globalThis.__arecaBenchmarkPool; setTimeout(() => process.getBuiltinModule('node:inspector').close(), 200); true",
        returnByValue: true,
      })
    } catch {}
    ws.close()
  }
}
main().catch((error) => {
  console.error(error.name + ': ' + error.message)
  process.exitCode = 1
})
