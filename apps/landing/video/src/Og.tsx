import { AbsoluteFill } from 'remotion'
import { Fronds } from './Fronds'
import { LogoMark } from './Logo'
import { C, SANS } from './theme'

/** 1200x630 share image, drawn with the same fronds as the hero. */
export function Og() {
  return (
    <AbsoluteFill style={{ background: C.bg, fontFamily: SANS, color: C.fg }}>
      <Fronds
        style={{ position: 'absolute', right: -170, top: -60, width: 760 }}
        delay={-400}
      />
      <div style={{ position: 'absolute', left: 80, top: 86 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <LogoMark size={56} />
          <span
            style={{ fontSize: 46, fontWeight: 650, letterSpacing: '-0.04em' }}
          >
            Areca
          </span>
        </div>
        <h1
          style={{
            fontSize: 92,
            lineHeight: 1,
            fontWeight: 650,
            letterSpacing: '-0.05em',
            margin: '74px 0 0',
            maxWidth: 720,
          }}
        >
          Your website, in your hands.
        </h1>
        <p
          style={{
            fontSize: 32,
            color: C.muted,
            margin: '30px 0 0',
            maxWidth: 640,
            lineHeight: 1.35,
          }}
        >
          The open-source, self-hosted CMS for agencies.
        </p>
      </div>
    </AbsoluteFill>
  )
}
