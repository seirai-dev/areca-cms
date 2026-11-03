import { readFile } from 'node:fs/promises'
import { ssh, service, refreshApp } from './remote.mjs'
if (!service)
  throw new Error('BENCH_SERVICE is required for this Swarm configuration')
if (!process.argv[2])
  throw new Error('Supply the private metrics-token file path')
const token = (await readFile(process.argv[2], 'utf8')).trim()
if (token.length < 16 || /[\r\n]/.test(token))
  throw new Error(
    'Metrics token must have at least 16 characters and no line breaks',
  )
const script =
  "import sys,json,subprocess; p=json.load(sys.stdin); r=subprocess.run(['docker','service','update','--detach=false','--env-add','METRICS_TOKEN='+p['token'],p['service']],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); sys.exit(r.returncode)"
await ssh(
  `python3 -c '${script.replaceAll("'", "'\\''")}'`,
  JSON.stringify({ service, token }),
)
await refreshApp()
console.log(
  'Metrics bearer token configured; service update converged. No token was logged.',
)
