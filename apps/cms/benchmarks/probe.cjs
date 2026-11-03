// Runs inside the CMS container. Credentials stay in its environment; only
// operational numbers/statuses leave this process.
const net = require('node:net')
const tls = require('node:tls')

async function redisInfo() {
  const start = Date.now()
  const url = new URL(process.env.REDIS_URL)
  const commands = []
  if (url.password)
    commands.push([
      'AUTH',
      ...(url.username ? [decodeURIComponent(url.username)] : []),
      decodeURIComponent(url.password),
    ])
  commands.push(['INFO', 'all'])
  return new Promise((resolve) => {
    const socket =
      url.protocol === 'rediss:'
        ? tls.connect({ host: url.hostname, port: Number(url.port || 6379) })
        : net.connect({ host: url.hostname, port: Number(url.port || 6379) })
    let buffer = Buffer.alloc(0),
      responses = []
    const finish = (value) => {
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(3000, () =>
      finish({ error: 'timeout', ms: Date.now() - start }),
    )
    socket.on('error', () =>
      finish({ error: 'connection', ms: Date.now() - start }),
    )
    socket.on('connect', () =>
      socket.write(
        commands
          .map(
            (parts) =>
              `*${parts.length}\r\n` +
              parts.map((p) => `$${Buffer.byteLength(p)}\r\n${p}\r\n`).join(''),
          )
          .join(''),
      ),
    )
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      while (buffer.length) {
        const end = buffer.indexOf('\r\n')
        if (end < 0) return
        let consumed, value
        if (buffer[0] === 36) {
          const n = Number(buffer.subarray(1, end).toString())
          if (buffer.length < end + 2 + n + 2) return
          value = buffer.subarray(end + 2, end + 2 + n).toString()
          consumed = end + 2 + n + 2
        } else {
          value = buffer.subarray(0, end).toString()
          consumed = end + 2
        }
        responses.push(value)
        buffer = buffer.subarray(consumed)
        if (responses.length === commands.length) {
          const info = responses.at(-1),
            stats = { ms: Date.now() - start }
          if (commands.length > 1)
            stats.authRejected = responses[0].startsWith('-')
          if (info.startsWith('-'))
            return finish({ ...stats, error: 'auth-or-command' })
          const keys = new Set([
            'used_memory',
            'maxmemory',
            'connected_clients',
            'blocked_clients',
            'rejected_connections',
            'total_error_replies',
            'evicted_keys',
            'keyspace_hits',
            'keyspace_misses',
            'total_commands_processed',
            'instantaneous_ops_per_sec',
            'used_cpu_sys',
            'used_cpu_user',
            'total_net_input_bytes',
            'total_net_output_bytes',
          ])
          for (const line of info.split('\r\n')) {
            const command = line.match(/^cmdstat_([^:]+):(.*)$/)
            if (command) {
              const fields = Object.fromEntries(
                command[2].split(',').map((p) => p.split('=')),
              )
              if (Number(fields.failed_calls) || Number(fields.rejected_calls))
                (stats.commandErrors ??= {})[command[1]] = {
                  failed: Number(fields.failed_calls) || 0,
                  rejected: Number(fields.rejected_calls) || 0,
                }
            }
            const errorStat = line.match(/^errorstat_([A-Z0-9_]+):count=(\d+)$/)
            if (errorStat) {
              ;(stats.errorRepliesByType ??= {})[errorStat[1]] = Number(
                errorStat[2],
              )
            }
            const [key, value] = line.split(':')
            if (keys.has(key) && Number.isFinite(Number(value)))
              stats[key] = Number(value)
          }
          return finish(stats)
        }
      }
    })
  })
}
async function health(url) {
  const start = Date.now()
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
    await res.arrayBuffer()
    return { status: res.status, ms: Date.now() - start }
  } catch {
    return { error: 'timeout-or-connection', ms: Date.now() - start }
  }
}
async function metrics() {
  if (!process.env.METRICS_TOKEN) return { enabled: false, status: 404 }
  const started = Date.now()
  try {
    const res = await fetch(
      `http://127.0.0.1:${process.env.PORT || 3000}/api/metrics`,
      {
        headers: { Authorization: `Bearer ${process.env.METRICS_TOKEN}` },
        signal: AbortSignal.timeout(5000),
      },
    )
    const body = await res.text(),
      samples = []
    if (res.status === 200)
      for (const line of body.split('\n')) {
        const match = line.match(
          /^([a-zA-Z_:][\w:]*)(\{.*\})?\s+([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|[+-]?Inf|NaN)(?:\s+\d+)?$/,
        )
        if (match)
          samples.push({
            name: match[1],
            labels: match[2] || null,
            value: Number.isFinite(Number(match[3]))
              ? Number(match[3])
              : match[3],
          })
      }
    return {
      enabled: true,
      status: res.status,
      ms: Date.now() - started,
      samples,
    }
  } catch {
    return {
      enabled: true,
      error: 'timeout-or-connection',
      ms: Date.now() - started,
    }
  }
}
Promise.all([
  redisInfo(),
  health(new URL('/health/ready', process.env.S3_ENDPOINT)),
  health(`http://127.0.0.1:${process.env.PORT || 3000}/api/health`),
  metrics(),
])
  .then(([redis, s3, cms, metrics]) =>
    console.log(JSON.stringify({ redis, s3, cms, metrics })),
  )
  .catch(() => console.log(JSON.stringify({ error: 'probe-failed' })))
