// Renders the tour, the hero loop, the poster and the share image into the
// landing app's public folder. Usage: pnpm --filter @areca/landing-video render
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const pub = new URL('../public/', import.meta.url).pathname
mkdirSync(`${pub}video`, { recursive: true })
const run = (...args) =>
  execFileSync('npx', ['remotion', ...args, '--log=error'], {
    stdio: 'inherit',
  })

run(
  'render',
  'src/index.ts',
  'Tour',
  'out/tour.mp4',
  '--codec=h264',
  '--crf=18',
)
run(
  'render',
  'src/index.ts',
  'Loop',
  'out/loop.mp4',
  '--codec=h264',
  '--crf=20',
)
run('still', 'src/index.ts', 'Og', `${pub}og.png`)

// Web encodes: H.264 for everyone, VP9 WebM where supported, a lighter loop.
const ff = (...args) =>
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], {
    stdio: 'inherit',
  })
ff(
  '-i',
  'out/tour.mp4',
  '-c:v',
  'libx264',
  '-preset',
  'slow',
  '-crf',
  '22',
  '-pix_fmt',
  'yuv420p',
  '-movflags',
  '+faststart',
  '-an',
  `${pub}video/areca-tour.mp4`,
)
ff(
  '-i',
  'out/tour.mp4',
  '-c:v',
  'libvpx-vp9',
  '-b:v',
  '0',
  '-crf',
  '34',
  '-row-mt',
  '1',
  '-an',
  `${pub}video/areca-tour.webm`,
)
ff(
  '-i',
  'out/loop.mp4',
  '-vf',
  'scale=1600:-2',
  '-c:v',
  'libx264',
  '-preset',
  'slow',
  '-crf',
  '25',
  '-pix_fmt',
  'yuv420p',
  '-movflags',
  '+faststart',
  '-an',
  `${pub}video/areca-loop.mp4`,
)
ff(
  '-i',
  'out/loop.mp4',
  '-frames:v',
  '1',
  '-vf',
  'scale=1600:-2',
  '/tmp/areca-poster.png',
)
console.log('rendered')
