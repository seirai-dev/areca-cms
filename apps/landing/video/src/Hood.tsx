import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from 'remotion'
import { C, MONO, SANS } from './theme'

const FILES = [
  'coffees.json',
  'journal.json',
  'team.json',
  '_globals.json',
  'public/areca/green-valley-5afe7f72.jpg',
]
const CMD = 'pnpm exec areca pull'

/** Snapshot -> areca pull -> static files -> visitors, with the CMS asleep. */
export function Hood() {
  const frame = useCurrentFrame()
  const { fps, durationInFrames } = useVideoConfig()
  const t = (a: number, b: number) =>
    interpolate(frame, [a, b], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.bezier(0.22, 1, 0.36, 1),
    })
  const fade = interpolate(
    frame,
    [0, 8, durationInFrames - 8, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  )
  const typed = Math.round(
    interpolate(frame, [40, 76], [0, CMD.length], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  )
  const snap = t(10, 40)
  const dim = t(150, 175)
  const head = spring({ frame: frame - 2, fps, config: { damping: 200 } })
  return (
    <AbsoluteFill
      style={{ background: C.bg, opacity: fade, fontFamily: SANS, color: C.fg }}
    >
      <div style={{ position: 'absolute', left: 140, top: 96, opacity: head }}>
        <p
          style={{ fontSize: 30, color: C.irisInk, fontWeight: 600, margin: 0 }}
        >
          Under the hood
        </p>
        <h2
          style={{
            fontSize: 76,
            fontWeight: 650,
            letterSpacing: '-0.04em',
            margin: '14px 0 0',
          }}
        >
          Published pages never call the CMS.
        </h2>
      </div>
      {/* CMS */}
      <div
        style={{
          position: 'absolute',
          left: 140,
          top: 430,
          width: 360,
          height: 300,
          borderRadius: 24,
          border: `2px solid ${dim > 0.5 ? C.line : C.iris}`,
          background: C.raised,
          opacity: 1 - dim * 0.55,
          padding: 30,
        }}
      >
        <p style={{ fontSize: 34, fontWeight: 650, margin: 0 }}>Areca CMS</p>
        <p style={{ fontSize: 24, color: C.muted, marginTop: 10 }}>
          Release frozen
        </p>
        <div
          style={{
            marginTop: 26,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 18px',
            borderRadius: 14,
            background: 'rgba(88,86,214,.16)',
            fontFamily: MONO,
            fontSize: 22,
            color: C.irisInk,
            opacity: snap * (1 - dim),
            transform: `translateY(${(1 - snap) * 12}px)`,
          }}
        >
          sha256 9f3c…a71e
        </div>
        <p
          style={{
            position: 'absolute',
            top: 150,
            left: 30,
            right: 30,
            fontSize: 26,
            lineHeight: 1.35,
            color: C.muted,
            opacity: dim,
          }}
        >
          Asleep. Nobody asks it anything.
        </p>
      </div>
      {/* Arrow CMS -> build */}
      <svg
        style={{ position: 'absolute', left: 500, top: 560 }}
        width="160"
        height="40"
      >
        <line
          x1="10"
          y1="20"
          x2="150"
          y2="20"
          stroke={C.iris}
          strokeWidth="3"
          strokeDasharray="140"
          strokeDashoffset={140 * (1 - t(28, 46))}
          opacity={1 - dim}
        />
        <line
          x1="10"
          y1="20"
          x2="150"
          y2="20"
          stroke={C.line}
          strokeWidth="3"
          strokeDasharray="6 10"
          opacity={dim}
        />
      </svg>
      {/* Build terminal */}
      <div
        style={{
          position: 'absolute',
          left: 660,
          top: 400,
          width: 600,
          height: 360,
          borderRadius: 24,
          background: '#0a0a0c',
          border: `2px solid ${C.line}`,
          padding: 32,
          fontFamily: MONO,
          fontSize: 25,
        }}
      >
        <p
          style={{ margin: 0, color: C.faint, fontFamily: SANS, fontSize: 24 }}
        >
          Site build
        </p>
        <p style={{ margin: '22px 0 16px', color: C.fg }}>
          <span style={{ color: C.faint }}>$ </span>
          {CMD.slice(0, typed)}
          <span
            style={{ opacity: frame % 20 < 10 && typed < CMD.length ? 1 : 0 }}
          >
            ▍
          </span>
        </p>
        {FILES.map((f, i) => {
          const v = t(84 + i * 9, 100 + i * 9)
          return (
            <p
              key={f}
              style={{
                margin: '6px 0',
                color: C.muted,
                opacity: v,
                transform: `translateX(${(1 - v) * -10}px)`,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              <span style={{ color: C.live }}>+ </span>
              {f}
            </p>
          )
        })}
      </div>
      {/* Arrow build -> site */}
      <svg
        style={{ position: 'absolute', left: 1260, top: 560 }}
        width="140"
        height="40"
      >
        <line
          x1="10"
          y1="20"
          x2="130"
          y2="20"
          stroke={C.live}
          strokeWidth="3"
          strokeDasharray="120"
          strokeDashoffset={120 * (1 - t(132, 148))}
        />
      </svg>
      {/* Site with visitors */}
      <div
        style={{
          position: 'absolute',
          left: 1400,
          top: 430,
          width: 380,
          height: 300,
          borderRadius: 24,
          border: `2px solid ${C.live}`,
          background: C.raised,
          padding: 30,
          opacity: t(136, 150),
        }}
      >
        <p style={{ fontSize: 34, fontWeight: 650, margin: 0 }}>Your site</p>
        <p style={{ fontSize: 24, color: C.muted, marginTop: 10 }}>
          Static files
        </p>
        <div style={{ display: 'flex', gap: 14, marginTop: 34 }}>
          {[0, 1, 2, 3, 4].map((i) => {
            const v = spring({
              frame: frame - 150 - i * 5,
              fps,
              config: { damping: 14 },
            })
            return (
              <div
                key={i}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 99,
                  border: `2px solid ${C.muted}`,
                  transform: `scale(${v})`,
                }}
              />
            )
          })}
        </div>
        <p
          style={{
            position: 'absolute',
            bottom: 24,
            left: 30,
            fontFamily: MONO,
            fontSize: 24,
            color: C.live,
            opacity: t(165, 180),
          }}
        >
          0 requests to the CMS
        </p>
      </div>
    </AbsoluteFill>
  )
}
