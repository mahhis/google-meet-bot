const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, rmSync, statSync, writeFileSync, readFileSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const http = require('node:http')
const { spawn, spawnSync } = require('node:child_process')
const { ActivityTracker, createLifecycle } = require('../../dist/helpers/lifecycle.js')
const { run } = require('@grammyjs/runner')
const SHA = 'a'.repeat(40)
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
function request(socketPath, path = '/ready', method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path, method }, res => {
      let body = ''; res.on('data', b => { body += b }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }))
    }); req.once('error', reject); req.end()
  })
}

test('readiness requires attached live runner, Mongo, exact identity and no draining', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bot-')); const socketPath = join(dir, 'life.sock')
  let mongo = false; let running = true; let closed = 0
  const lifecycle = createLifecycle({ socketPath, version: SHA, signals: false, ready: () => mongo, close: async () => { closed++ } })
  try {
    await lifecycle.open()
    assert.equal(statSync(socketPath).mode & 0o777, 0o600)
    assert.equal((await request(socketPath)).status, 503)
    lifecycle.attach({ isRunning: () => running, stop: async () => { running = false } })
    assert.equal((await request(socketPath)).status, 503)
    mongo = true
    const good = await request(socketPath)
    assert.equal(good.status, 200); assert.equal(good.body.version, SHA); assert.equal(good.body.pid, process.pid)
    running = false; assert.equal((await request(socketPath)).status, 503)
    running = true; const drained = await request(socketPath, '/drain', 'POST')
    assert.equal(drained.body.draining, true); assert.equal(drained.body.active, 0)
    assert.equal((await request(socketPath)).status, 503)
    await lifecycle.shutdown(); await lifecycle.shutdown(); assert.equal(closed, 1)
  } finally { await lifecycle.shutdown(); rmSync(dir, { recursive: true, force: true }) }
})

test('actual locked runner1.x stop does not close DB before tracked concurrent updates finish', { timeout: 3000 }, async () => {
  const tracker = new ActivityTracker(); const work = deferred(); const started = deferred(); let calls = 0; let closed = false
  const bot = { init: async () => {},
    api: { getUpdates: async (_options, signal) => {
      if (calls++ === 0) return [{ update_id: 1 }, { update_id: 2 }]
      return new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true }) })
    } },
    handleUpdate: () => tracker.track(async () => { if (tracker.active === 2) started.resolve(); await work.promise }),
    errorHandler: async error => { throw error }
  }
  const lifecycle = createLifecycle({ tracker, signals: false, ready: () => true, close: async () => { closed = true } })
  lifecycle.attach(run(bot)); await started.promise
  let done = false; const shutdown = lifecycle.shutdown().then(() => { done = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(lifecycle.state().draining, true); assert.equal(lifecycle.state().active, 2)
  assert.equal(done, false); assert.equal(closed, false)
  work.resolve(); await shutdown; assert.equal(closed, true); assert.equal(tracker.active, 0)
})

test('handler error releases tracking but stop failure never reports a drained ready bot', async () => {
  const tracker = new ActivityTracker()
  await assert.rejects(tracker.track(async () => { throw new Error('handler') }), /handler/)
  assert.equal(tracker.active, 0)
  let closed = false
  const lifecycle = createLifecycle({ tracker, signals: false, ready: () => true, close: async () => { closed = true } })
  lifecycle.attach({ isRunning: () => true, stop: async () => { throw new Error('stop failed') } })
  await assert.rejects(lifecycle.shutdown(), /stop failed/)
  assert.equal(closed, false); assert.equal(lifecycle.state().ready, false); assert.equal(lifecycle.state().failure, true)
})

test('refuses to overwrite an ordinary file or an active socket', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bot-')); const socketPath = join(dir, 'life.sock')
  const options = { socketPath, version: SHA, signals: false, ready: () => true, close: async () => {} }
  try {
    writeFileSync(socketPath, 'keep')
    await assert.rejects(createLifecycle(options).open(), /non-owned lifecycle socket/)
    assert.equal(readFileSync(socketPath, 'utf8'), 'keep'); rmSync(socketPath)
    const first = createLifecycle(options); await first.open()
    await assert.rejects(createLifecycle(options).open(), /already owned by a live process/)
    assert.equal((await request(socketPath)).status, 503)
    await first.shutdown()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a dead owned Unix socket is safely replaced', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bot-')); const socketPath = join(dir, 'life.sock')
  const child = spawnSync('python3', ['-c', 'import socket,sys;s=socket.socket(socket.AF_UNIX);s.bind(sys.argv[1]);s.close()', socketPath])
  assert.equal(child.status, 0)
  const lifecycle = createLifecycle({ socketPath, version: SHA, signals: false, ready: () => true, close: async () => {} })
  try { await lifecycle.open(); assert.equal((await request(socketPath)).status, 503) }
  finally { await lifecycle.shutdown(); rmSync(dir, { recursive: true, force: true }) }
})


test('SIGTERM waits for active callbacks and exits without forced process termination', { timeout: 4000 }, async () => {
  const lifecycleModule = require.resolve('../../dist/helpers/lifecycle.js')
  const program = `
    const { ActivityTracker, createLifecycle } = require(${JSON.stringify(lifecycleModule)});
    const tracker = new ActivityTracker();
    let done = false;
    const life = createLifecycle({ tracker, ready: () => true, close: async () => {
      if (!done) throw Error('DB closed before handler'); process.stdout.write('closed-after-handler');
    }});
    (async () => {
      await life.open(); life.attach({ isRunning: () => true, stop: async () => {} });
      tracker.track(async () => { await new Promise(r => setTimeout(r, 180)); done = true; });
      process.send('ready');
    })();
  `
  const child = spawn(process.execPath, ['-e', program], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: {} })
  let output = ''; let error = ''
  child.stdout.on('data', b => { output += b }); child.stderr.on('data', b => { error += b })
  child.once('message', () => child.kill('SIGTERM'))
  const exit = await new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  assert.deepEqual(exit, { code: 0, signal: null }, error)
  assert.equal(output, 'closed-after-handler')
})

test('shutdown during startup cannot launch a new poller later', async () => {
  const life = createLifecycle({ signals: false, ready: () => false, close: async () => {} })
  await life.shutdown()
  let launched = false
  assert.throws(() => life.launch(() => { launched = true; return { isRunning: () => true, stop: async () => {} } }), /Startup cancelled/)
  assert.equal(launched, false)
})
