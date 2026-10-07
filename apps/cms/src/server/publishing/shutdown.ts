import { createLogger } from '#/server/log'

const logger = createLogger('shutdown')

const g = globalThis as typeof globalThis & {
  __arecaShutdownInstalled?: boolean
}

export type ShutdownDeps = {
  /** Stops claiming and drains in-flight jobs; resolves true if all finished. */
  stop: () => Promise<boolean>
  exit: (code: number) => void
}

/**
 * Builds the signal handler. The first signal drains the worker (bounded by
 * the caller's timeout) and then exits the process explicitly: the HTTP server
 * library only closes its listener on SIGTERM, while our timers and the
 * Postgres pool would keep the process alive until the container is killed.
 * A second signal exits immediately.
 */
export function createShutdownHandler({ stop, exit }: ShutdownDeps) {
  let shuttingDown = false
  return async (signal: string) => {
    if (shuttingDown) {
      logger.warn('second signal received; exiting now', { signal })
      exit(1)
      return
    }
    shuttingDown = true
    logger.info('shutting down', { signal })
    let code = 0
    try {
      const drained = await stop()
      if (!drained) code = 1
    } catch (error) {
      logger.error('shutdown failed', { err: error })
      code = 1
    }
    exit(code)
  }
}

/**
 * Registers SIGTERM/SIGINT once per process (guarded on globalThis because
 * dev-mode HMR re-evaluates server.ts). Does not interfere with
 * scripts/docker-entrypoint.mjs, which forwards the signal to this process and
 * waits for it to exit.
 */
export function installShutdownHandlers(deps: ShutdownDeps) {
  if (g.__arecaShutdownInstalled) return false
  g.__arecaShutdownInstalled = true
  const handler = createShutdownHandler(deps)
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => void handler(signal))
  }
  return true
}

export function resetShutdownForTest() {
  g.__arecaShutdownInstalled = undefined
}
