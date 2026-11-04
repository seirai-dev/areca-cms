import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { Fronds } from './Fronds'
import { LogoMark } from './Logo'
import { C, MONO, SANS } from './theme'

export function Outro() {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const a = spring({ frame, fps, config: { damping: 200 } })
  const b = spring({ frame: frame - 12, fps, config: { damping: 200 } })
  const c = spring({ frame: frame - 24, fps, config: { damping: 200 } })
  return (
    <AbsoluteFill style={{ background: C.bg, fontFamily: SANS, color: C.fg }}>
      <Fronds
        style={{ position: 'absolute', right: -160, bottom: -200, width: 1000 }}
        delay={-200}
        opacity={0.6}
      />
      <div style={{ position: 'absolute', left: 170, top: 330 }}>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 22, opacity: a }}
        >
          <LogoMark size={80} />
          <span
            style={{ fontSize: 84, fontWeight: 650, letterSpacing: '-0.045em' }}
          >
            Areca
          </span>
        </div>
        <p
          style={{
            fontSize: 60,
            fontWeight: 620,
            letterSpacing: '-0.035em',
            margin: '40px 0 0',
            opacity: b,
            transform: `translateY(${(1 - b) * 14}px)`,
          }}
        >
          Open source. Self-hosted. MIT licensed.
        </p>
        <div
          style={{
            display: 'flex',
            gap: 40,
            marginTop: 44,
            fontFamily: MONO,
            fontSize: 32,
            opacity: c,
          }}
        >
          <span style={{ color: C.irisInk }}>arecacms.com</span>
          <span style={{ color: C.muted }}>
            github.com/seirai-dev/areca-cms
          </span>
        </div>
      </div>
    </AbsoluteFill>
  )
}
