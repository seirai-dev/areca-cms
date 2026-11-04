import { AbsoluteFill, Sequence } from 'remotion'
import { FramedClip, BleedClip } from './ClipScene'
import { SCENES, sceneFrames, FPS, type ClipScene } from './edit'
import { Fronds } from './Fronds'
import { Hood } from './Hood'
import { Intro } from './Intro'
import { Outro } from './Outro'
import { C } from './theme'

export function Tour() {
  let at = 0
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Fronds
        style={{ position: 'absolute', right: -260, bottom: -300, width: 900 }}
        delay={-400}
        opacity={0.12}
      />
      {SCENES.map((s, i) => {
        const frames = sceneFrames(s)
        const from = at
        at += frames
        return (
          <Sequence key={i} from={from} durationInFrames={frames}>
            {s.kind === 'intro' ? (
              <Intro />
            ) : s.kind === 'hood' ? (
              <Hood />
            ) : s.kind === 'outro' ? (
              <Outro />
            ) : (
              <FramedClip scene={s as ClipScene} />
            )}
          </Sequence>
        )
      })}
    </AbsoluteFill>
  )
}

// The hero loop: three full-bleed moments, no captions.
export const LOOP: ClipScene[] = [
  {
    kind: 'clip',
    clip: '04-visual',
    caption: '',
    parts: [{ from: 4.2, to: 13.6, rate: 1.3 }],
    cam: [
      { at: 4.2, zoom: 1.12, x: 0.6, y: 0.5 },
      { at: 13.6, zoom: 1.25, x: 0.66, y: 0.55 },
    ],
  },
  {
    kind: 'clip',
    clip: '03-write',
    caption: '',
    parts: [{ from: 3.4, to: 21, rate: 3.6 }],
    cam: [{ at: 0, zoom: 1.2, x: 0.38, y: 0.45 }],
  },
  {
    kind: 'clip',
    clip: '08b-building',
    caption: '',
    parts: [
      { from: 12, to: 20.6, rate: 4 },
      { from: 20.6, to: 23.4, rate: 1 },
    ],
    cam: [{ at: 0, zoom: 1.35, x: 0.8, y: 0.4 }],
  },
  {
    kind: 'clip',
    clip: '09-livesite',
    caption: '',
    parts: [{ from: 0.3, to: 6.8, rate: 1.3 }],
  },
]
export const LOOP_FRAMES = LOOP.reduce((n, s) => n + sceneFrames(s), 0)

export function Loop() {
  let at = 0
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {LOOP.map((s, i) => {
        const frames = sceneFrames(s)
        const from = at
        at += frames
        return (
          <Sequence key={i} from={from} durationInFrames={frames}>
            <BleedClip scene={s} />
          </Sequence>
        )
      })}
    </AbsoluteFill>
  )
}

export { FPS }
