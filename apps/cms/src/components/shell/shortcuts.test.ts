// @vitest-environment happy-dom
import * as React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShortcutsProvider, useShortcut } from './shortcuts'

function Shortcut({
  combo,
  handler,
  whileTyping,
}: {
  combo: string
  handler: () => void
  whileTyping?: boolean
}) {
  useShortcut(combo, handler, { whileTyping })
  return null
}

function setup(shortcut: React.ComponentProps<typeof Shortcut>) {
  render(
    React.createElement(
      ShortcutsProvider,
      null,
      React.createElement(Shortcut, shortcut),
      React.createElement('input', { type: 'search' }),
    ),
  )
  return document.querySelector('input') as HTMLInputElement
}

function press(target: EventTarget, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  })
  target.dispatchEvent(event)
  return event
}

afterEach(cleanup)

describe('useShortcut', () => {
  it('ignores plain keys while typing', () => {
    const handler = vi.fn()
    const field = setup({ combo: 'escape', handler })
    press(field, 'Escape')
    expect(handler).not.toHaveBeenCalled()
    press(document.body, 'Escape')
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('fires a whileTyping key in a field and leaves the key its own effect', () => {
    const handler = vi.fn()
    const field = setup({ combo: 'escape', handler, whileTyping: true })
    const event = press(field, 'Escape')
    expect(handler).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(false)
  })

  it('leaves a key an overlay already handled', () => {
    const handler = vi.fn()
    const field = setup({ combo: 'escape', handler, whileTyping: true })
    const stop = (event: Event) => event.preventDefault()
    document.addEventListener('keydown', stop, { capture: true })
    press(field, 'Escape')
    document.removeEventListener('keydown', stop, { capture: true })
    expect(handler).not.toHaveBeenCalled()
  })

  it('fires mod combos while typing', () => {
    const handler = vi.fn()
    const field = setup({ combo: 'mod+k', handler })
    press(field, 'k', { metaKey: true })
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
