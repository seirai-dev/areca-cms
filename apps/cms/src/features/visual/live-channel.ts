/**
 * The live channel's state machine (docs/design/visual-editor.md, Decisions 2-4).
 *
 * Pure: it takes an event and returns the next state. The hook in
 * `use-live-preview.ts` does the I/O (ping, fetch, postMessage, timers) and reads
 * this machine to decide what to do next.
 *
 * - `tier`: `connecting` until the bridge answers (or the handshake times out), then
 *   `live`, or `on-save` when no bridge answers.
 * - At most one request is in flight. A value change while one is in flight marks
 *   the value stale, so exactly one more request follows with the newest value.
 * - Each request has a sequence number. A response is applied only when it belongs to
 *   the request in flight, so an older result never replaces a newer one.
 */

export const PING_INTERVAL_MS = 250
export const HANDSHAKE_TIMEOUT_MS = 3000
export const DEBOUNCE_MS = 150
export const RETRY_MS = 2000

export type Tier = 'connecting' | 'on-save' | 'live'

/** The request state the UI shows: nothing, a request running, or the last one failed. */
export type RequestStatus = 'idle' | 'loading' | 'error'

export type ChannelState = {
  tier: Tier
  /** Sequence number of the request in flight, or null. */
  inFlight: number | null
  /** The last sequence number issued. Never goes back, even across frame reloads. */
  seq: number
  /** Sequence number of the last successful result. */
  applied: number
  /** Consecutive failed requests. Reset by a success. */
  failures: number
  /** The value changed (or a failure happened) since the last request was sent. */
  stale: boolean
}

export const initialChannel: ChannelState = {
  tier: 'connecting',
  inFlight: null,
  seq: 0,
  applied: 0,
  failures: 0,
  stale: false,
}

export type ChannelEvent =
  /** The iframe finished loading: the bridge is new, so the handshake starts again. */
  | { type: 'frame-loaded' }
  /** A valid hello arrived from the frame. */
  | { type: 'hello' }
  /** No hello within HANDSHAKE_TIMEOUT_MS. */
  | { type: 'handshake-timeout' }
  /** The unsaved value (data or locale) changed. */
  | { type: 'value-changed' }
  /** The debounce elapsed or a retry is due: send the newest value if one is needed. */
  | { type: 'send' }
  /** A request finished. `ok` is false for a network error or a non-2xx answer. */
  | { type: 'response'; seq: number; ok: boolean }

export function channelReducer(
  state: ChannelState,
  event: ChannelEvent,
): ChannelState {
  switch (event.type) {
    case 'frame-loaded':
      return { ...state, tier: 'connecting', stale: false }

    case 'hello':
      if (state.tier === 'live') return state
      // Going live sends the current value at once; the page may show an old one.
      return { ...state, tier: 'live', stale: true }

    case 'handshake-timeout':
      return state.tier === 'connecting' ? { ...state, tier: 'on-save' } : state

    case 'value-changed':
      return state.tier === 'live' && !state.stale
        ? { ...state, stale: true }
        : state

    case 'send': {
      if (state.tier !== 'live' || !state.stale || state.inFlight !== null) {
        return state
      }
      const seq = state.seq + 1
      return { ...state, seq, inFlight: seq, stale: false }
    }

    case 'response': {
      // Only the request in flight counts. Anything else is an older answer.
      if (event.seq !== state.inFlight) return state
      if (!event.ok) {
        return {
          ...state,
          inFlight: null,
          failures: state.failures + 1,
          stale: true,
        }
      }
      return {
        ...state,
        inFlight: null,
        applied: Math.max(state.applied, event.seq),
        failures: 0,
      }
    }
  }
}

export function requestStatus(state: ChannelState): RequestStatus {
  if (state.inFlight !== null) return 'loading'
  if (state.failures > 0) return 'error'
  return 'idle'
}
