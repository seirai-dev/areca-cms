// Procedural areca palm frond: a curved rachis with pinnate leaflets that
// taper towards the tip. Deterministic, so it renders the same on the server
// and in the browser. Shared by the landing page art and the video.

type Point = { x: number; y: number }

export type FrondOptions = {
  /** Base of the stem. */
  base: Point
  /** Bezier control point that sets the arch. */
  control: Point
  /** Tip of the frond. */
  tip: Point
  /** Leaflet pairs along the rachis. */
  leaflets?: number
  /** Longest leaflet, reached around the middle. */
  maxLength?: number
  /** Angle between leaflet and rachis, in degrees. */
  spread?: number
  /** How much each leaflet bends back towards the tip (0-1). */
  droop?: number
  /** Where along the rachis the leaflets begin (0-1). */
  start?: number
}

export type Frond = {
  rachis: string
  leaflets: Array<{ d: string; t: number; side: 1 | -1 }>
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

function bezier(p0: Point, p1: Point, p2: Point, t: number): Point {
  const u = 1 - t
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  }
}

function tangent(p0: Point, p1: Point, p2: Point, t: number): Point {
  const x = 2 * (1 - t) * (p1.x - p0.x) + 2 * t * (p2.x - p1.x)
  const y = 2 * (1 - t) * (p1.y - p0.y) + 2 * t * (p2.y - p1.y)
  const len = Math.hypot(x, y) || 1
  return { x: x / len, y: y / len }
}

const r = (n: number) => Math.round(n * 10) / 10

export function frond({
  base,
  control,
  tip,
  leaflets = 22,
  maxLength = 120,
  spread = 38,
  droop = 0.35,
  start = 0.14,
}: FrondOptions): Frond {
  const out: Frond['leaflets'] = []
  const angle = (spread * Math.PI) / 180
  for (let i = 0; i < leaflets; i++) {
    const t = lerp(start, 0.985, i / (leaflets - 1))
    const p = bezier(base, control, tip, t)
    const tan = tangent(base, control, tip, t)
    // Leaflets are longest a little before the middle and shrink at the tip.
    const k = (t - start) / (1 - start)
    const length =
      maxLength *
      Math.pow(Math.sin(Math.PI * Math.min(1, k * 0.92 + 0.08)), 0.75)
    for (const side of [1, -1] as const) {
      const normal = { x: -tan.y * side, y: tan.x * side }
      const dir = {
        x: tan.x * Math.cos(angle) + normal.x * Math.sin(angle),
        y: tan.y * Math.cos(angle) + normal.y * Math.sin(angle),
      }
      const end = { x: p.x + dir.x * length, y: p.y + dir.y * length }
      // Bend the leaflet back along the rachis, plus a little gravity.
      const mid = {
        x: p.x + dir.x * length * 0.55 + tan.x * length * droop * 0.5,
        y:
          p.y +
          dir.y * length * 0.55 +
          tan.y * length * droop * 0.5 +
          length * droop * 0.25,
      }
      out.push({
        d: `M${r(p.x)} ${r(p.y)}Q${r(mid.x)} ${r(mid.y)} ${r(end.x)} ${r(end.y)}`,
        t,
        side,
      })
    }
  }
  return {
    rachis: `M${r(base.x)} ${r(base.y)}Q${r(control.x)} ${r(control.y)} ${r(tip.x)} ${r(tip.y)}`,
    leaflets: out,
  }
}
