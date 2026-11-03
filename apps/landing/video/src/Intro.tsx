import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'
import { Fronds } from './Fronds'
import { LogoMark } from './Logo'
import { C, SANS } from './theme'

export function Intro() {
  const frame = useCurrentFrame()
  const { fps, durationInFrames } = useVideoConfig()
  const logo = spring({
    frame: frame - 18,
    fps,
    config: { damping: 18, mass: 0.7 },
  })
  const line = spring({ frame: frame - 34, fps, config: { damping: 200 } })
  const out = interpolate(
    frame,
    [durationInFrames - 8, durationInFrames],
    [1, 0],
    { extrapolateLeft: 'clamp' },
  )
  return (
    <AbsoluteFill style={{ background: C.bg, opacity: out, fontFamily: SANS }}>
      <Fronds
        style={{ position: 'absolute', right: -120, top: -40, width: 1150 }}
        speed={1.4}
      />
      <div style={{ position: 'absolute', left: 170, top: 380 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 26,
            opacity: logo,
            transform: `translateY(${(1 - logo) * 24}px)`,
          }}
        >
          <LogoMark size={96} />
          <span
            style={{
              fontSize: 104,
              fontWeight: 650,
              letterSpacing: '-0.045em',
              color: C.fg,
            }}
          >
            Areca
          </span>
        </div>
        <p
          style={{
            marginTop: 34,
            fontSize: 52,
            fontWeight: 560,
            letterSpacing: '-0.03em',
            color: C.muted,
            opacity: line,
            transform: `translateY(${(1 - line) * 16}px)`,
          }}
        >
          Your website, in your hands.
        </p>
      </div>
    </AbsoluteFill>
  )
}
