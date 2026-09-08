import { chmodSync, lstatSync, readFileSync, unlinkSync } from 'fs'
import { createServer, Server } from 'http'
import { createConnection } from 'net'
import { isAbsolute, join } from 'path'

export class ActivityTracker {
  private count = 0
  private waiters = new Set<() => void>()
  get active() { return this.count }
  async track<T>(work: () => Promise<T>): Promise<T> {
    this.count += 1
    try { return await work() }
    finally {
      this.count -= 1
      if (this.count === 0) {
        for (const resolve of this.waiters) resolve()
        this.waiters.clear()
      }
    }
  }
  middleware() {
    return (_context: unknown, next: () => Promise<void>) => this.track(next)
  }
  idle(): Promise<void> {
    return this.count === 0 ? Promise.resolve() : new Promise((resolve) => this.waiters.add(resolve))
  }
}

export const activity = new ActivityTracker()
type Runner = { isRunning(): boolean; stop(): Promise<void> | undefined }
type Options = {
  ready(): boolean
  close(): Promise<void>
  tracker?: ActivityTracker
  socketPath?: string
  version?: string
  signals?: boolean
}

async function removeDeadSocket(path: string) {
  let info: import('fs').Stats
  try { info = lstatSync(path) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  if (!info.isSocket() || (process.getuid && info.uid !== process.getuid())) {
    throw new Error('Refusing to replace a non-owned lifecycle socket')
  }
  await new Promise<void>((resolve, reject) => {
    const probe = createConnection(path)
    probe.once('connect', () => { probe.destroy(); reject(new Error('Lifecycle socket is already owned by a live process')) })
    probe.once('error', (error: NodeJS.ErrnoException) => {
      if (!['ECONNREFUSED', 'ENOENT'].includes(error.code ?? '')) { reject(error); return }
      try {
        const current = lstatSync(path)
        if (current.ino !== info.ino || current.dev !== info.dev) throw new Error('Lifecycle socket changed while checking')
        unlinkSync(path)
        resolve()
      } catch (failure) {
        if ((failure as NodeJS.ErrnoException).code === 'ENOENT') resolve()
        else reject(failure)
      }
    })
    probe.setTimeout(1000, () => { probe.destroy(); reject(new Error('Existing lifecycle socket did not respond')) })
  })
}

export function createLifecycle(options: Options) {
  const tracker = options.tracker ?? activity
  const socketPath = options.socketPath ?? process.env.BOT_LIFECYCLE_SOCKET
  let version = options.version ?? 'development'
  if (socketPath && options.version === undefined) {
    version = readFileSync(process.env.BOT_RELEASE_FILE ?? join(process.cwd(), 'RELEASE_SHA'), 'utf8').trim()
    if (!/^[a-f0-9]{40}$/.test(version)) throw new Error('A production release SHA is required')
  }
  let runner: Runner | undefined
  let draining = false
  let drainPromise: Promise<void> | undefined
  let shutdownPromise: Promise<void> | undefined
  let server: Server | undefined
  let started = false
  let failure = false
  const state = () => ({
    ready: started && !draining && !failure && Boolean(runner?.isRunning()) && options.ready(),
    pid: process.pid, version, active: tracker.active, draining,
    runnerRunning: Boolean(runner?.isRunning()), databaseReady: options.ready(), failure,
  })
  const drain = () => {
    if (!drainPromise) {
      draining = true
      drainPromise = (async () => {
        // Runner1.x stops fetching before its concurrent sink necessarily empties.
        // Our outer middleware counts even updates waiting in sequentialize().
        await runner?.stop()
        await tracker.idle()
      })().catch((error) => { failure = true; throw error })
    }
    return drainPromise
  }
  const onSignal = () => {
    void shutdown().then(() => { process.exitCode = 0 }, () => { process.exitCode = 1 })
  }
  const shutdown = () => {
    if (!shutdownPromise) shutdownPromise = (async () => {
      await drain()
      await options.close()
      if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()))
      process.removeListener('SIGTERM', onSignal)
      process.removeListener('SIGINT', onSignal)
      process.removeListener('SIGQUIT', onSignal)
    })()
    return shutdownPromise
  }
  return {
    state, drain, shutdown,
    attach(handle: Runner) { runner = handle; started = true },
    launch(factory: () => Runner) {
      if (draining) throw new Error('Startup cancelled by shutdown')
      runner = factory(); started = true
    },
    async open() {
      if (socketPath) {
        if (!isAbsolute(socketPath)) throw new Error('Lifecycle socket path must be absolute')
        await removeDeadSocket(socketPath)
        server = createServer((request, response) => {
          response.setHeader('Content-Type', 'application/json')
          response.setHeader('Cache-Control', 'no-store')
          if (request.method === 'GET' && ['/ready', '/status'].includes(request.url ?? '')) {
            const result = state()
            response.statusCode = request.url === '/ready' && !result.ready ? 503 : 200
            response.end(JSON.stringify(result))
          } else if (request.method === 'POST' && request.url === '/drain') {
            void drain().then(() => response.end(JSON.stringify(state())), () => {
              response.statusCode = 500
              response.end(JSON.stringify(state()))
            })
          } else { response.statusCode = 404; response.end() }
        })
        server.requestTimeout = 10000
        server.headersTimeout = 10000
        await new Promise<void>((resolve, reject) => {
          server!.once('error', reject)
          server!.listen(socketPath, () => { chmodSync(socketPath, 0o600); resolve() })
        })
      }
      if (options.signals !== false) {
        process.once('SIGTERM', onSignal)
        process.once('SIGINT', onSignal)
        process.once('SIGQUIT', onSignal)
      }
    },
  }
}
