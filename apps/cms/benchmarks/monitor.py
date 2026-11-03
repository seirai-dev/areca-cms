"""Read-only sampler, streamed over SSH. All output is numeric operational data."""
import json, os, shutil, subprocess, sys, time
# PROBE_SOURCE_PLACEHOLDER

def command(args, timeout=8):
    return subprocess.check_output(args, text=True, timeout=timeout).strip()

def cpu():
    with open('/proc/stat') as f:
        values = list(map(int, f.readline().split()[1:]))
    return sum(values), values[3] + values[4], values

previous = cpu()
index = 0
while True:
    started = time.monotonic()
    try:
        current = cpu()
        delta = current[0] - previous[0]
        busy = 100 * (1 - (current[1] - previous[1]) / delta) if delta else 0
        steal = 100 * (current[2][7] - previous[2][7]) / delta if delta else 0
        iowait = 100 * (current[2][4] - previous[2][4]) / delta if delta else 0
        previous = current
        with open('/proc/meminfo') as f:
            mem = {line.split(':')[0]: int(line.split()[1]) for line in f}
        with open('/proc/diskstats') as f:
            disks = [line.split() for line in f if line.split()[2] in ['sda', 'vda', 'nvme0n1']]
        with open('/proc/pressure/io') as f:
            io_pressure = f.read().strip()
        names = command(['docker', 'ps', '--format', '{{.Names}}']).splitlines()
        relevant = [name for name in names if name.startswith('areca-cms-') or name == 'dokploy-traefik']
        stats = command(['docker', 'stats', '--no-stream', '--format', '{{json .}}'] + relevant)
        states = []
        for name in relevant:
            states.append(json.loads(command(['docker', 'inspect', '--format', '{"name":{{json .Name}},"restarts":{{.RestartCount}},"oom":{{.State.OOMKilled}},"status":{{json .State.Status}}}', name])))
        sample = dict(at=time.time(), cpu_percent=busy, cpu_steal_percent=steal, cpu_iowait_percent=iowait, load1=os.getloadavg()[0],
            available_mb=mem['MemAvailable']/1024, total_mb=mem['MemTotal']/1024,
            swap_free_mb=mem['SwapFree']/1024, disk_free_gb=shutil.disk_usage('/').free/1024**3,
            disks=disks, io_pressure=io_pressure, containers=[json.loads(line) for line in stats.splitlines()], states=states)
        if index % 3 == 0:
            db = next(name for name in names if name.startswith('areca-cms-db-'))
            query = "SELECT json_build_object('connections',count(*),'active',count(*) FILTER (WHERE state='active'),'waiting_lock',count(*) FILTER (WHERE wait_event_type='Lock'),'idle_in_transaction',count(*) FILTER (WHERE state='idle in transaction'),'oldest_active_seconds',coalesce(max(extract(epoch FROM now()-query_start)) FILTER (WHERE state='active'),0),'oldest_transaction_seconds',coalesce(max(extract(epoch FROM now()-xact_start)),0)) FROM pg_stat_activity WHERE datname=current_database(); SELECT json_build_object('commits',xact_commit,'rollbacks',xact_rollback,'deadlocks',deadlocks,'temp_bytes',temp_bytes,'blocks_read',blks_read,'blocks_hit',blks_hit) FROM pg_stat_database WHERE datname=current_database(); SELECT json_build_object('wait_event_type',wait_event_type,'wait_event',wait_event,'connections',count(*)) FROM pg_stat_activity WHERE datname=current_database() GROUP BY wait_event_type,wait_event;"
            out = subprocess.run(['docker','exec','-i',db,'sh','-c','exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atq'], input=query, capture_output=True, text=True, timeout=8)
            sample['postgres'] = [json.loads(line) for line in out.stdout.splitlines() if line.startswith('{')]
            if 'PROBE_SOURCE' in globals():
                cms = next(name for name in names if name.startswith('areca-cms-app-'))
                try:
                    raw_probe = command(['docker','exec',cms,'node','-e',PROBE_SOURCE], timeout=7)
                    probe_lines = [line for line in raw_probe.splitlines() if line.startswith('{')]
                    sample['probes'] = json.loads(probe_lines[-1])
                except Exception as error:
                    sample['probes'] = dict(error=type(error).__name__)
        print(json.dumps(sample), flush=True)
    except Exception as error:
        print(json.dumps(dict(at=time.time(), error=type(error).__name__)), flush=True)
    index += 1
    time.sleep(max(0.2, 5 - (time.monotonic() - started)))
