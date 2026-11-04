import { interpolate, useCurrentFrame, Easing } from 'remotion'
import { frond } from '../../src/components/art/frond'
import { C } from './theme'

const FRONDS = [
  frond({
    base: { x: 560, y: 680 },
    control: { x: 300, y: 430 },
    tip: { x: 90, y: 150 },
    leaflets: 19,
    maxLength: 175,
    spread: 30,
    droop: 0.85,
  }),
  frond({
    base: { x: 600, y: 680 },
    control: { x: 540, y: 300 },
    tip: { x: 330, y: 30 },
    leaflets: 17,
    maxLength: 150,
    spread: 26,
    droop: 0.9,
  }),
  frond({
    base: { x: 640, y: 680 },
    control: { x: 470, y: 560 },
    tip: { x: 40, y: 470 },
    leaflets: 15,
    maxLength: 130,
    spread: 34,
    droop: 0.9,
  }),
]

/** The landing page fronds. `draw` is a 0-1 progress for the draw-in. */
export function Fronds({
  style,
  delay = 0,
  speed = 1,
  opacity = 1,
}: {
  style?: React.CSSProperties
  delay?: number
  speed?: number
  opacity?: number
}) {
  const frame = useCurrentFrame() - delay
  const ease = Easing.bezier(0.22, 1, 0.36, 1)
  const p = (start: number, dur: number) =>
    interpolate(frame, [start / speed, (start + dur) / speed], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: ease,
    })
  return (
    <svg viewBox="0 0 680 680" style={style} fill="none">
      {FRONDS.map((f, i) => {
        const sway =
          Math.sin((frame + i * 40) / (45 + i * 12)) * (0.8 - i * 0.2)
        const origin = `${[560, 600, 640][i]}px 660px`
        return (
          <g
            key={i}
            stroke={C.frond}
            strokeLinecap="round"
            opacity={(i === 1 ? 1 : i === 0 ? 0.85 : 0.5) * opacity}
            style={{ transform: `rotate(${sway}deg)`, transformOrigin: origin }}
          >
            <path
              d={f.rachis}
              strokeWidth={2.2}
              pathLength={1}
              strokeDasharray="1 1"
              strokeDashoffset={1 - p(4 + i * 5, 32)}
            />
            {f.leaflets.map((l, j) => {
              const v = p(10 + i * 5 + l.t * 32, 20)
              return (
                <path
                  key={j}
                  d={l.d}
                  strokeWidth={1.3}
                  pathLength={1}
                  strokeDasharray="1 1"
                  strokeDashoffset={1 - v}
                  opacity={v}
                />
              )
            })}
          </g>
        )
      })}
    </svg>
  )
}
