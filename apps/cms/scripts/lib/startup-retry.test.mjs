import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_STARTUP_DEADLINE_SECONDS,
  StartupDeadlineError,
  retryUntilDeadline,
  startupDeadlineMs,
} from './startup-retry.mjs'

// A clock that only moves when the helper sleeps, so retries cost no real time.
function fakeClock() {
  let now = 1_000_000
  const sleeps = []
  return {
    sleeps,
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms)
      now += ms
    },
    deadline: now + 60_000,
  }
}

test('uses a 60 second default deadline', () => {
  assert.equal(startupDeadlineMs({}), DEFAULT_STARTUP_DEADLINE_SECONDS * 1000)
  assert.equal(startupDeadlineMs({ STARTUP_DEADLINE_SECONDS: '' }), 60_000)
})

test('reads STARTUP_DEADLINE_SECONDS and rejects bad values', () => {
  assert.equal(startupDeadlineMs({ STARTUP_DEADLINE_SECONDS: '15' }), 15_000)
  for (const bad of ['0', '-5', 'soon', 'Infinity']) {
    assert.throws(
      () => startupDeadlineMs({ STARTUP_DEADLINE_SECONDS: bad }),
      /STARTUP_DEADLINE_SECONDS must be a positive number/,
      bad,
    )
  }
})

test('returns the first success without waiting', async () => {
  const clock = fakeClock()
  const value = await retryUntilDeadline('postgres', async () => 'up', {
    deadline: clock.deadline,
    now: clock.now,
    sleep: clock.sleep,
    log: () => {},
  })
  assert.equal(value, 'up')
  assert.deepEqual(clock.sleeps, [])
})

test('retries with growing, capped delays and then succeeds', async () => {
  const clock = fakeClock()
  const logs = []
  let calls = 0
  const value = await retryUntilDeadline(
    'postgres',
    async () => {
      calls += 1
      if (calls < 6) throw new Error('connection refused')
      return 'up'
    },
    {
      deadline: clock.deadline,
      now: clock.now,
      sleep: clock.sleep,
      log: (message) => logs.push(message),
    },
  )
  assert.equal(value, 'up')
  assert.equal(calls, 6)
  // Doubling from one second, capped at five seconds: never a tight loop.
  assert.deepEqual(clock.sleeps, [1000, 2000, 4000, 5000, 5000])
  assert.equal(logs.length, 5)
  assert.match(logs[0], /postgres not ready \(attempt 1: connection refused\)/)
  assert.match(logs[0], /retrying in 1s, 60s left/)
})

test('gives up at the deadline with the last failure and never sleeps past it', async () => {
  const clock = fakeClock()
  let calls = 0
  await assert.rejects(
    retryUntilDeadline(
      'postgres',
      async () => {
        calls += 1
        throw new Error('no route to host')
      },
      {
        deadline: clock.now() + 2500,
        now: clock.now,
        sleep: clock.sleep,
        log: () => {},
      },
    ),
    (error) => {
      assert.ok(error instanceof StartupDeadlineError)
      assert.match(error.message, /postgres did not become ready/)
      assert.match(error.message, /no route to host/)
      return true
    },
  )
  // 1s, then 1.5s (only what is left), then stop.
  assert.deepEqual(clock.sleeps, [1000, 1500])
  assert.equal(calls, 3)
  assert.equal(clock.now(), 1_000_000 + 2500)
})

test('stops immediately when the deadline has already passed', async () => {
  const clock = fakeClock()
  let calls = 0
  await assert.rejects(
    retryUntilDeadline(
      'redis',
      async () => {
        calls += 1
        throw new Error('refused')
      },
      {
        deadline: clock.now(),
        now: clock.now,
        sleep: clock.sleep,
        log: () => {},
      },
    ),
    StartupDeadlineError,
  )
  assert.equal(calls, 1)
  assert.deepEqual(clock.sleeps, [])
})
