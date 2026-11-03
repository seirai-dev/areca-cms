// Read-only configuration inventory. Never return raw environment/spec objects.
import { writeFile } from 'node:fs/promises'
import { ssh, sql } from './remote.mjs'
const source = String.raw`
import json,subprocess,os
from urllib.parse import urlsplit
def cmd(args): return subprocess.check_output(args,text=True).strip()
def inspect(kind,name): return json.loads(cmd(['docker',kind,'inspect',name]) if kind else cmd(['docker','inspect',name]))[0]
allowed={'NODE_ENV','PORT','DB_POOL_MAX','DB_CONNECT_TIMEOUT_MS','DB_STATEMENT_TIMEOUT_MS','DB_IDLE_IN_TX_TIMEOUT_MS','WORKER_ENABLED','WORKER_CONCURRENCY','RATE_LIMIT_TRUST_PROXY','UV_THREADPOOL_SIZE','SESSION_COOKIE_CACHE_SECONDS','HTTP_KEEP_ALIVE_TIMEOUT_MS','NODE_OPTIONS'}
def environment(items):
    result={}
    for item in items or []:
        key,_,value=item.partition('=')
        if key in allowed: result[key]=value
        if key in {'S3_ENDPOINT','DATABASE_URL','REDIS_URL'}:
            try:
                u=urlsplit(value);result[key+'_ROUTE']={'scheme':u.scheme,'host':u.hostname,'port':u.port}
            except Exception: result[key+'_ROUTE']={'invalid':True}
    return result
containers=[]
for name in cmd(['docker','ps','--format','{{.Names}}']).splitlines():
    if not (name.startswith('areca-cms-') or name=='dokploy-traefik' or name.startswith('dokploy.')): continue
    c=inspect('',name);h=c['HostConfig'];cfg=c['Config']
    record={'name':name,'image':cfg['Image'],'imageId':c['Image'],'environment':environment(cfg.get('Env')),
        'runtime':{k:h.get(k) for k in ['NanoCpus','CpuQuota','CpuPeriod','CpusetCpus','Memory','MemoryReservation','MemorySwap','PidsLimit','ShmSize','OomKillDisable','RestartPolicy']},
        'mounts':[{k:m.get(k) for k in ['Type','Source','Destination','RW']} for m in c.get('Mounts',[])],
        'networks':list(c['NetworkSettings']['Networks']),
        'ports':c['NetworkSettings'].get('Ports'),
        'healthcheck':{k:v for k,v in cfg.get('Healthcheck',{}).items() if k!='Test'},
        'healthcheckConfigured':bool(cfg.get('Healthcheck'))}
    if name.startswith(('areca-cms-app-','areca-cms-worker-')):
        record['cgroup']={}
        for path in ['cpu.max','cpu.stat','memory.max','memory.events']:
            try: record['cgroup'][path]=cmd(['docker','exec',name,'cat','/sys/fs/cgroup/'+path])
            except Exception: pass
    containers.append(record)
services=[]
for name in cmd(['docker','service','ls','--format','{{.Name}}']).splitlines():
    if not (name.startswith('areca-cms-') or name=='dokploy'):continue
    s=inspect('service',name);spec=s['Spec'];t=spec['TaskTemplate']
    services.append({'name':name,'mode':spec.get('Mode'),'resources':t.get('Resources'),
        'placement':t.get('Placement'),'restartPolicy':t.get('RestartPolicy'),'updateConfig':spec.get('UpdateConfig'),
        'endpoint':s.get('Endpoint',{}).get('Spec'),'environment':environment(t['ContainerSpec'].get('Env'))})
cpus=json.loads(cmd(['lscpu','--json']))['lscpu']
selected={x['field'].rstrip(':'):x['data'] for x in cpus if x['field'].rstrip(':') in ['CPU(s)','Model name','Thread(s) per core','Core(s) per socket','Socket(s)','Hypervisor vendor']}
print(json.dumps({'host':{'cpu':selected,'load':os.getloadavg()},'containers':containers,'services':services}))
`
const inventory = JSON.parse(await ssh('python3 -', source))
inventory.postgres = JSON.parse(
  await sql(
    `SELECT json_agg(json_build_object('name',name,'setting',setting,'unit',unit,'source',source)) FROM pg_settings WHERE name IN ('max_connections','shared_buffers','work_mem','effective_cache_size','max_worker_processes','max_parallel_workers','max_parallel_workers_per_gather','checkpoint_timeout','wal_compression','jit','track_io_timing','synchronous_commit','fsync');`,
  ),
)
const destination =
  process.argv[2] || new URL('./.local/deployment-config.json', import.meta.url)
await writeFile(destination, JSON.stringify(inventory, null, 2))
console.log(
  `Saved sanitized read-only deployment inventory (${inventory.containers.length} containers, ${inventory.services.length} services)`,
)
