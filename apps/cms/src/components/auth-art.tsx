import { useMemo } from 'react'

import { cn } from '#/lib/utils'

/** Small deterministic PRNG so the art is identical on server and client. */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Ring = { d: string; opacity: number; width: number }

/**
 * Builds a family of nested, gently deformed closed curves that read as
 * topographic contour lines. Each ring shares the same harmonic phases so the
 * deformation grows coherently outward, like elevation lines on a map.
 */
function buildContours(seed: number, cx: number, cy: number, count: number) {
  const rand = mulberry32(seed)
  const harmonics = [2, 3, 5, 7].map((k) => ({
    k,
    phase: rand() * Math.PI * 2,
    amp: (0.05 + rand() * 0.06) / (k / 2),
  }))
  const rings: Ring[] = []
  const steps = 96
  for (let i = 0; i < count; i++) {
    const base = 26 + i * 22
    const growth = 1 + i * 0.045
    const points: string[] = []
    for (let s = 0; s <= steps; s++) {
      const theta = (s / steps) * Math.PI * 2
      let r = base
      for (const h of harmonics) {
        r += base * h.amp * growth * Math.sin(h.k * theta + h.phase)
      }
      const x = cx + r * Math.cos(theta)
      const y = cy + r * Math.sin(theta) * 0.86
      points.push(`${x.toFixed(1)} ${y.toFixed(1)}`)
    }
    rings.push({
      d: `M${points.join('L')}Z`,
      // Low alpha: the art is a texture behind the tagline, never a picture.
      opacity: 0.34 - i * (0.22 / count),
      width: i % 4 === 0 ? 1.6 : 0.9,
    })
  }
  return rings
}

/**
 * Procedural contour artwork for the auth screens. The base comes from the
 * `art-base` token and the lines from `action-primary`, so the art re-tints
 * with the theme and with the instance accent colour (branding overrides
 * `--color-action-primary`, which also drives the primary button).
 */
export function AuthArt({ className }: { className?: string }) {
  const layers = useMemo(
    () => [buildContours(11, 620, 520, 22), buildContours(29, 180, 140, 10)],
    [],
  )

  return (
    <svg
      viewBox="0 0 900 900"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      className={cn('h-full w-full', className)}
    >
      <rect width="900" height="900" className="fill-art-base" />
      {layers.map((rings, layerIndex) => (
        <g key={layerIndex} className="stroke-action-primary" fill="none">
          {rings.map((ring, index) => (
            <path
              key={index}
              d={ring.d}
              strokeWidth={ring.width}
              strokeOpacity={ring.opacity}
              strokeLinejoin="round"
            />
          ))}
        </g>
      ))}
    </svg>
  )
}
