import {
  AbsoluteFill,
  Easing,
  interpolate,
  OffthreadVideo,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'
import { FPS, sceneToSource, type Cam, type ClipScene as Scene } from './edit'
import { C, SANS } from './theme'

const ease = Easing.bezier(0.65, 0, 0.35, 1)

/** Interpolates the camera keyframes at source time t (seconds). */
function camAt(cam: Cam[] | undefined, t: number): Cam {
  if (!cam?.length) return { at: 0, zoom: 1, x: 0.5, y: 0.5 }
  if (t <= cam[0].at) return cam[0]
  for (let i = 0; i < cam.length - 1; i++) {
    const a = cam[i]
    const b = cam[i + 1]
    if (t <= b.at) {
      const k = ease((t - a.at) / (b.at - a.at || 1))
      return {
        at: t,
        zoom: a.zoom + (b.zoom - a.zoom) * k,
        x: a.x + (b.x - a.x) * k,
        y: a.y + (b.y - a.y) * k,
      }
    }
  }
  return cam[cam.length - 1]
}

/** The clip parts played back to back at their own speeds. */
export function ClipParts({ scene }: { scene: Scene }) {
  let offset = 0
  return (
    <>
      {scene.parts.map((p, i) => {
        const frames = Math.round(((p.to - p.from) / p.rate) * FPS)
        const seq = (
          <Sequence
            key={i}
            from={offset}
            durationInFrames={frames}
            layout="none"
          >
            <OffthreadVideo
              src={staticFile(`clips/${scene.clip}.mp4`)}
              startFrom={Math.round(p.from * FPS)}
              playbackRate={p.rate}
              muted
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
              }}
            />
          </Sequence>
        )
        offset += frames
        return seq
      })}
    </>
  )
}

export function Camera({
  scene,
  children,
}: {
  scene: Scene
  children: React.ReactNode
}) {
  const frame = useCurrentFrame()
  const c = camAt(scene.cam, sceneToSource(scene.parts, frame / FPS))
  // Keep the focus point inside the frame so edges never show.
  const half = 0.5 / c.zoom
  const x = Math.min(1 - half, Math.max(half, c.x))
  const y = Math.min(1 - half, Math.max(half, c.y))
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        transform: `scale(${c.zoom}) translate(${(0.5 - x) * 100}%, ${(0.5 - y) * 100}%)`,
        transformOrigin: '50% 50%',
      }}
    >
      {children}
    </div>
  )
}

export function FramedClip({ scene }: { scene: Scene }) {
  const frame = useCurrentFrame()
  const { durationInFrames, fps } = useVideoConfig()
  const fade = interpolate(
    frame,
    [0, 7, durationInFrames - 6, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  )
  const cap = spring({ frame: frame - 4, fps, config: { damping: 200 } })
  const W = 1640
  const H = (W * 9) / 16
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <div
        style={{
          position: 'absolute',
          left: (1920 - W) / 2,
          top: 40,
          width: W,
          height: H,
          borderRadius: 22,
          overflow: 'hidden',
          border: `1px solid ${C.line}`,
          boxShadow: '0 50px 140px -40px rgba(88,86,214,.45)',
          background: '#000',
        }}
      >
        <Camera scene={scene}>
          <ClipParts scene={scene} />
        </Camera>
      </div>
      <div
        style={{
          position: 'absolute',
          left: (1920 - W) / 2 + 4,
          top: 40 + H + 30,
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          fontFamily: SANS,
          fontSize: 40,
          fontWeight: 600,
          letterSpacing: '-0.025em',
          color: C.fg,
          opacity: cap,
          transform: `translateY(${(1 - cap) * 14}px)`,
        }}
      >
        <span
          style={{
            width: 12,
            height: 12,
            borderRadius: 99,
            background: C.iris,
            boxShadow: `0 0 0 6px rgba(88,86,214,.25)`,
          }}
        />
        {scene.caption}
      </div>
    </AbsoluteFill>
  )
}

/** Full-bleed variant for the hero loop: no frame, no caption. */
export function BleedClip({ scene }: { scene: Scene }) {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const fade = interpolate(
    frame,
    [0, 8, durationInFrames - 8, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  )
  return (
    <AbsoluteFill style={{ opacity: fade, background: '#000' }}>
      <Camera scene={scene}>
        <ClipParts scene={scene} />
      </Camera>
    </AbsoluteFill>
  )
}
