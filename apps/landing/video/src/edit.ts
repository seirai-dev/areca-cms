// The edit decision list for the product tour.
// Each scene plays one recorded clip in parts; each part has its own speed so
// typing and AI waits move quickly while interactions stay readable.

export const FPS = 30

export type Part = {
  /** Seconds into the source clip. */
  from: number
  to: number
  /** Playback speed for this part. */
  rate: number
}

/** A camera keyframe at a moment in the source clip (seconds): zoom and focus point (0-1). */
export type Cam = { at: number; zoom: number; x: number; y: number }

export type ClipScene = {
  kind: 'clip'
  clip: string
  caption: string
  parts: Part[]
  cam?: Cam[]
}

export type ArtScene = { kind: 'intro' | 'hood' | 'outro'; seconds: number }

export type Scene = ClipScene | ArtScene

export const SCENES: Scene[] = [
  { kind: 'intro', seconds: 3.6 },
  {
    kind: 'clip',
    clip: '01-agency',
    caption: 'One CMS for every client.',
    parts: [{ from: 0.5, to: 11.2, rate: 1.7 }],
    cam: [
      { at: 0.5, zoom: 1, x: 0.5, y: 0.5 },
      { at: 2.7, zoom: 1.35, x: 0.2, y: 0.3 },
      { at: 6.7, zoom: 1.35, x: 0.2, y: 0.3 },
      { at: 8.1, zoom: 1, x: 0.5, y: 0.5 },
    ],
  },
  {
    kind: 'clip',
    clip: '02-branding',
    caption: 'Your brand, not ours.',
    parts: [{ from: 0.6, to: 11.4, rate: 1.9 }],
    cam: [
      { at: 0.6, zoom: 1.25, x: 0.45, y: 0.62 },
      { at: 6.9, zoom: 1.25, x: 0.45, y: 0.62 },
      { at: 8.4, zoom: 1, x: 0.5, y: 0.5 },
    ],
  },
  {
    kind: 'clip',
    clip: '03-write',
    caption: 'Write in a calm, distraction-free editor.',
    parts: [
      { from: 0.4, to: 3.2, rate: 1.4 },
      { from: 3.2, to: 24, rate: 4.4 },
      { from: 24, to: 32, rate: 2 },
    ],
    cam: [
      { at: 0.4, zoom: 1, x: 0.5, y: 0.5 },
      { at: 4.1, zoom: 1.28, x: 0.36, y: 0.42 },
      { at: 19.2, zoom: 1.28, x: 0.36, y: 0.5 },
      { at: 22.8, zoom: 1.3, x: 0.82, y: 0.55 },
      { at: 29.9, zoom: 1.3, x: 0.82, y: 0.6 },
    ],
  },
  {
    kind: 'clip',
    clip: '04-visual',
    caption: 'See the real page as you type. Click it to edit.',
    parts: [
      { from: 0.3, to: 2, rate: 1.2 },
      { from: 2, to: 4.2, rate: 3 },
      { from: 4.2, to: 14.4, rate: 1.55 },
    ],
    cam: [
      { at: 0.3, zoom: 1, x: 0.5, y: 0.5 },
      { at: 5.9, zoom: 1, x: 0.5, y: 0.5 },
      { at: 7.5, zoom: 1.45, x: 0.68, y: 0.55 },
      { at: 12.6, zoom: 1.45, x: 0.68, y: 0.55 },
      { at: 14.2, zoom: 1, x: 0.5, y: 0.5 },
    ],
  },
  {
    kind: 'clip',
    clip: '05-languages',
    caption: 'Every language side by side. AI fills the gaps.',
    parts: [
      { from: 0.4, to: 2.6, rate: 1.2 },
      { from: 2.6, to: 8, rate: 5 },
      { from: 8, to: 12, rate: 1.2 },
    ],
    cam: [
      { at: 0.4, zoom: 1, x: 0.5, y: 0.5 },
      { at: 3.4, zoom: 1.3, x: 0.38, y: 0.45 },
      { at: 12, zoom: 1.3, x: 0.38, y: 0.5 },
    ],
  },
  {
    kind: 'clip',
    clip: '06-seo',
    caption: 'SEO and answer-engine fields, drafted by AI. You decide.',
    parts: [
      { from: 0.3, to: 2.2, rate: 1.2 },
      { from: 2.2, to: 15.6, rate: 9 },
      { from: 15.6, to: 23.4, rate: 1.7 },
    ],
    cam: [
      { at: 0.3, zoom: 1, x: 0.5, y: 0.5 },
      { at: 9.6, zoom: 1.4, x: 0.5, y: 0.48 },
      { at: 21.7, zoom: 1.4, x: 0.5, y: 0.56 },
      { at: 23.1, zoom: 1, x: 0.5, y: 0.5 },
    ],
  },
  {
    kind: 'clip',
    clip: '07-ready',
    caption: 'Owners approve. Ready is not live yet.',
    parts: [{ from: 0.3, to: 4.6, rate: 1.1 }],
    cam: [
      { at: 0.3, zoom: 1.5, x: 0.78, y: 0.12 },
      { at: 4.6, zoom: 1.5, x: 0.78, y: 0.12 },
    ],
  },
  {
    kind: 'clip',
    clip: '08-golive',
    caption: 'Go live freezes a snapshot and builds the site.',
    parts: [{ from: 0.6, to: 7.4, rate: 1.6 }],
    cam: [
      { at: 0.6, zoom: 1, x: 0.5, y: 0.5 },
      { at: 2.4, zoom: 1.45, x: 0.82, y: 0.38 },
      { at: 7.4, zoom: 1.45, x: 0.82, y: 0.38 },
    ],
  },
  {
    kind: 'clip',
    clip: '08b-building',
    caption: 'Built, health-checked, live.',
    parts: [
      { from: 0, to: 20.6, rate: 6 },
      { from: 20.6, to: 24.2, rate: 1 },
    ],
    cam: [
      { at: 0, zoom: 1.45, x: 0.82, y: 0.38 },
      { at: 24, zoom: 1.45, x: 0.82, y: 0.38 },
    ],
  },
  {
    kind: 'clip',
    clip: '09-livesite',
    caption: 'On the live site. Zero requests to the CMS.',
    parts: [{ from: 0.3, to: 7.6, rate: 1.5 }],
  },
  { kind: 'hood', seconds: 7.2 },
  { kind: 'outro', seconds: 4.8 },
]

export const sceneFrames = (s: Scene) =>
  s.kind === 'clip'
    ? s.parts.reduce(
        (n, p) => n + Math.round(((p.to - p.from) / p.rate) * FPS),
        0,
      )
    : Math.round(s.seconds * FPS)

export const TOTAL_FRAMES = SCENES.reduce((n, s) => n + sceneFrames(s), 0)

/** Maps a moment in the edited scene (seconds) back to the source clip. */
export function sceneToSource(parts: Part[], t: number): number {
  let acc = 0
  for (const p of parts) {
    const dur = (p.to - p.from) / p.rate
    if (t <= acc + dur) return p.from + (t - acc) * p.rate
    acc += dur
  }
  return parts[parts.length - 1].to
}
