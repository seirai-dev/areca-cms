import { describe, expect, it } from 'vitest'

import {
  DEFAULT_EDITOR_RATIO,
  DIVIDER_PX,
  EDITOR_MIN_PX,
  NUDGE_PX,
  PREVIEW_WIDTHS,
  VISUAL_MIN_VIEWPORT,
  editorColumnWidth,
  framePresentation,
  nudgeRatio,
  ratioFromPointer,
} from './visual-layout'

describe('constants', () => {
  it('matches the agreed layout numbers', () => {
    expect(VISUAL_MIN_VIEWPORT).toBe(1280)
    expect(DEFAULT_EDITOR_RATIO).toBe(0.36)
    expect(EDITOR_MIN_PX).toBe(360)
    expect(NUDGE_PX).toBe(16)
    expect(DIVIDER_PX).toBe(6)
    expect(PREVIEW_WIDTHS).toEqual({
      desktop: 'fill',
      fit1440: 1440,
      tablet: 768,
      mobile: 390,
    })
  })
})

describe('editorColumnWidth', () => {
  it('uses 36% at a typical laptop width when there is no user choice', () => {
    // 1440 * 0.36 = 518.4, inside the 400–720 default clamp.
    expect(editorColumnWidth(1440, null)).toBeCloseTo(518.4)
  })

  it('clamps the default up to 400 px on narrow layouts', () => {
    // 1280 * 0.36 = 460.8; 1100 * 0.36 = 396 is clamped up to 400.
    expect(editorColumnWidth(1100, null)).toBe(400)
  })

  it('clamps the default down to 720 px on very wide screens', () => {
    // 2560 * 0.36 = 921.6 is clamped to 720.
    expect(editorColumnWidth(2560, null)).toBe(720)
  })

  it('does not apply the default clamp to a chosen ratio', () => {
    // 1920 * 0.2 = 384 is below 400 but a user choice, so it stays.
    expect(editorColumnWidth(1920, 0.2)).toBeCloseTo(384)
  })

  it('never goes below 360 px even for a tiny chosen ratio', () => {
    expect(editorColumnWidth(1920, 0.05)).toBe(EDITOR_MIN_PX)
  })

  it('never takes more than half of the layout', () => {
    expect(editorColumnWidth(1280, 0.9)).toBe(640)
  })
})

describe('ratioFromPointer', () => {
  it('turns a pointer position into a ratio of the layout width', () => {
    expect(ratioFromPointer(500, 1000)).toBeCloseTo(0.5)
  })

  it('clamps to the 360 px minimum', () => {
    expect(ratioFromPointer(100, 1000)).toBeCloseTo(360 / 1000)
  })

  it('clamps to 50% of the layout width', () => {
    expect(ratioFromPointer(900, 1000)).toBe(0.5)
  })

  it('falls back to the default ratio for an empty layout', () => {
    expect(ratioFromPointer(300, 0)).toBe(DEFAULT_EDITOR_RATIO)
  })
})

describe('nudgeRatio', () => {
  it('moves the divider by the nudge distance', () => {
    const next = nudgeRatio(0.4, 1000, NUDGE_PX)
    expect(next).toBeCloseTo(0.416)
  })

  it('moves left with a negative delta', () => {
    expect(nudgeRatio(0.4, 1000, -NUDGE_PX)).toBeCloseTo(0.384)
  })

  it('starts from the resolved default when there is no choice yet', () => {
    // Default at 1000 px is 360 px, clamped up to 400 px; +16 px gives 416 px.
    expect(nudgeRatio(null, 1000, NUDGE_PX)).toBeCloseTo(416 / 1000)
  })

  it('stops at the bounds', () => {
    expect(nudgeRatio(0.5, 1000, NUDGE_PX)).toBe(0.5)
    expect(nudgeRatio(0.36, 1000, -1000)).toBeCloseTo(360 / 1000)
  })
})

describe('framePresentation', () => {
  it('fills the pane for the desktop preset', () => {
    expect(framePresentation('desktop', 800, 600)).toEqual({
      width: 800,
      height: 600,
      scale: 1,
    })
  })

  it('renders at 1440 and scales down to fit a narrower pane', () => {
    const frame = framePresentation('fit1440', 720, 600)
    expect(frame.width).toBe(1440)
    expect(frame.scale).toBeCloseTo(0.5)
    // Height is in unscaled pixels so the scaled box fills the pane height.
    expect(frame.height * frame.scale).toBeCloseTo(600)
  })

  it('does not scale up when the pane is wider than 1440', () => {
    expect(framePresentation('fit1440', 1800, 900)).toEqual({
      width: 1440,
      height: 900,
      scale: 1,
    })
  })

  it('uses a fixed width for tablet and mobile', () => {
    expect(framePresentation('tablet', 1200, 700)).toEqual({
      width: 768,
      height: 700,
      scale: 1,
    })
    expect(framePresentation('mobile', 1200, 700)).toEqual({
      width: 390,
      height: 700,
      scale: 1,
    })
  })

  it('keeps tablet at 768 and scales it to fit a narrower pane', () => {
    const frame = framePresentation('tablet', 384, 600)
    expect(frame.width).toBe(768)
    expect(frame.scale).toBeCloseTo(0.5)
    // Height is unscaled so the scaled box fills the pane height.
    expect(frame.height * frame.scale).toBeCloseTo(600)
  })

  it('keeps mobile at 390 and scales it to fit a narrower pane', () => {
    const frame = framePresentation('mobile', 300, 600)
    expect(frame.width).toBe(390)
    expect(frame.scale).toBeCloseTo(300 / 390)
    expect(frame.height * frame.scale).toBeCloseTo(600)
  })

  it('does not scale tablet or mobile up in a wide pane', () => {
    expect(framePresentation('tablet', 1200, 700).scale).toBe(1)
    expect(framePresentation('mobile', 1200, 700).scale).toBe(1)
  })

  it('does not divide by zero for an unmeasured pane', () => {
    const frame = framePresentation('fit1440', 0, 600)
    expect(Number.isFinite(frame.height)).toBe(true)
    expect(frame.scale).toBe(1)
  })
})
