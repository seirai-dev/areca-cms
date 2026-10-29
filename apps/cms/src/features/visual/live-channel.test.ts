import { describe, expect, it } from 'vitest'

import { channelReducer, initialChannel, requestStatus } from './live-channel'
import type { ChannelState } from './live-channel'

/** Runs events in order and returns the final state. */
function run(
  events: Parameters<typeof channelReducer>[1][],
  from = initialChannel,
) {
  return events.reduce<ChannelState>(
    (state, event) => channelReducer(state, event),
    from,
  )
}

const live = run([{ type: 'frame-loaded' }, { type: 'hello' }])

describe('handshake', () => {
  it('starts connecting, with nothing in flight and no failures', () => {
    expect(initialChannel).toEqual({
      tier: 'connecting',
      inFlight: null,
      seq: 0,
      applied: 0,
      failures: 0,
      stale: false,
    })
  })

  it('a hello makes the channel live and asks for the current value', () => {
    const state = run([{ type: 'frame-loaded' }, { type: 'hello' }])
    expect(state.tier).toBe('live')
    expect(state.stale).toBe(true)
  })

  it('a handshake timeout while connecting falls back to on-save', () => {
    const state = run([{ type: 'frame-loaded' }, { type: 'handshake-timeout' }])
    expect(state.tier).toBe('on-save')
  })

  it('a timeout after a hello changes nothing', () => {
    expect(channelReducer(live, { type: 'handshake-timeout' })).toBe(live)
  })

  it('a hello after a timeout still makes the channel live', () => {
    const state = run([
      { type: 'frame-loaded' },
      { type: 'handshake-timeout' },
      { type: 'hello' },
    ])
    expect(state.tier).toBe('live')
  })

  it('a repeated hello while live changes nothing (no extra send)', () => {
    expect(channelReducer(live, { type: 'hello' })).toBe(live)
  })

  it('a frame load drops back to connecting, keeping the sequence', () => {
    const sent = run([{ type: 'send' }], live)
    const reloaded = channelReducer(sent, { type: 'frame-loaded' })
    expect(reloaded.tier).toBe('connecting')
    expect(reloaded.seq).toBe(sent.seq)
  })
})

describe('sending', () => {
  it('does not send while connecting or on-save', () => {
    const connecting = run([{ type: 'frame-loaded' }])
    expect(channelReducer(connecting, { type: 'send' })).toBe(connecting)

    const onSave = run([
      { type: 'frame-loaded' },
      { type: 'handshake-timeout' },
    ])
    expect(channelReducer(onSave, { type: 'value-changed' })).toBe(onSave)
    expect(channelReducer(onSave, { type: 'send' })).toBe(onSave)
  })

  it('sends when live and the value changed, numbering sequences upward', () => {
    const first = run([{ type: 'value-changed' }, { type: 'send' }], live)
    expect(first.inFlight).toBe(1)
    expect(first.seq).toBe(1)
    expect(first.stale).toBe(false)

    const second = run(
      [
        { type: 'response', seq: 1, ok: true },
        { type: 'value-changed' },
        { type: 'send' },
      ],
      first,
    )
    expect(second.inFlight).toBe(2)
  })

  it('does nothing when nothing changed since the last request', () => {
    const clean = run(
      [{ type: 'send' }, { type: 'response', seq: 1, ok: true }],
      live,
    )
    expect(clean.stale).toBe(false)
    expect(channelReducer(clean, { type: 'send' })).toBe(clean)
  })

  it('never has more than one request in flight', () => {
    const inFlight = run([{ type: 'send' }], live)
    expect(channelReducer(inFlight, { type: 'value-changed' })).toMatchObject({
      stale: true,
    })
    expect(
      channelReducer(run([{ type: 'send' }, { type: 'value-changed' }], live), {
        type: 'send',
      }),
    ).toMatchObject({
      inFlight: 1,
      seq: 1,
    })
  })

  it('a change during a request is kept for one more send after the response', () => {
    const state = run([{ type: 'send' }, { type: 'value-changed' }], live)
    const answered = channelReducer(state, {
      type: 'response',
      seq: 1,
      ok: true,
    })
    expect(answered.inFlight).toBeNull()
    expect(answered.stale).toBe(true)
    expect(channelReducer(answered, { type: 'send' })).toMatchObject({
      inFlight: 2,
      seq: 2,
      stale: false,
    })
  })
})

describe('responses (latest wins)', () => {
  it('a successful response becomes the applied one', () => {
    const state = run(
      [{ type: 'send' }, { type: 'response', seq: 1, ok: true }],
      live,
    )
    expect(state.applied).toBe(1)
    expect(state.failures).toBe(0)
  })

  it('ignores a response for a sequence that is not in flight', () => {
    const state = run([{ type: 'send' }], live)
    expect(channelReducer(state, { type: 'response', seq: 0, ok: true })).toBe(
      state,
    )
    expect(channelReducer(state, { type: 'response', seq: 9, ok: false })).toBe(
      state,
    )
  })

  it('a failed response keeps the applied one, counts a failure and marks the value stale', () => {
    const state = run(
      [
        { type: 'send' },
        { type: 'response', seq: 1, ok: true },
        { type: 'value-changed' },
        { type: 'send' },
        { type: 'response', seq: 2, ok: false },
      ],
      live,
    )
    expect(state.applied).toBe(1)
    expect(state.failures).toBe(1)
    expect(state.stale).toBe(true)
    expect(state.inFlight).toBeNull()
  })

  it('consecutive failures count up, and a success resets them', () => {
    const failed = run(
      [
        { type: 'send' },
        { type: 'response', seq: 1, ok: false },
        { type: 'send' },
        { type: 'response', seq: 2, ok: false },
      ],
      live,
    )
    expect(failed.failures).toBe(2)
    const recovered = run(
      [{ type: 'send' }, { type: 'response', seq: 3, ok: true }],
      failed,
    )
    expect(recovered.failures).toBe(0)
  })

  it('a response that arrives after a reload still records what was applied', () => {
    const state = run(
      [
        { type: 'send' },
        { type: 'frame-loaded' },
        { type: 'response', seq: 1, ok: true },
        { type: 'handshake-timeout' },
      ],
      live,
    )
    expect(state.tier).toBe('on-save')
    expect(state.applied).toBe(1)
  })
})

describe('requestStatus', () => {
  it('is idle, loading while a request is in flight, and error after a failure', () => {
    expect(requestStatus(live)).toBe('idle')
    expect(requestStatus(run([{ type: 'send' }], live))).toBe('loading')
    expect(
      requestStatus(
        run([{ type: 'send' }, { type: 'response', seq: 1, ok: false }], live),
      ),
    ).toBe('error')
    expect(
      requestStatus(
        run(
          [
            { type: 'send' },
            { type: 'response', seq: 1, ok: false },
            { type: 'send' },
          ],
          live,
        ),
      ),
    ).toBe('loading')
  })

  it('a success clears the error', () => {
    const state = run(
      [
        { type: 'send' },
        { type: 'response', seq: 1, ok: false },
        { type: 'send' },
        { type: 'response', seq: 2, ok: true },
      ],
      live,
    )
    expect(requestStatus(state)).toBe('idle')
  })
})
