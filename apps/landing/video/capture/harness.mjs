// Recording harness for the product video.
// Drives the real CMS with Playwright, draws a smooth cursor inside the page,
// and records the tab through the DevTools screencast at high JPEG quality.
// Frames are stitched into a constant 30 fps MP4 with ffmpeg.
import { chromium } from '@playwright/test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { CMS as cmsUrl, SITE as siteUrl } from './env.mjs'

export const CMS = cmsUrl()
export const SITE = siteUrl()
const STATE = process.env.ARECA_STATE ?? '/tmp/areca-landing/auth.json'
const OUT = new URL('../public/clips/', import.meta.url).pathname
const FRAMES = '/tmp/areca-landing/frames'

// 1536x864 CSS pixels at 1.25x gives a crisp 1920x1080 frame with readable UI.
const VIEWPORT = { width: 1536, height: 864 }
const SCALE = 1.25

const cursorScript = () => {
  const install = () => {
    if (window.top !== window || document.getElementById('__rec_cursor')) return
    const el = document.createElement('div')
    el.id = '__rec_cursor'
    el.innerHTML = `<svg width="26" height="26" viewBox="0 0 26 26"><path d="M5 3l15 8.2-6.6 1.6 3.7 7.4-2.9 1.4-3.7-7.4L5 19z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>`
    Object.assign(el.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      zIndex: '2147483647',
      pointerEvents: 'none',
      transform: 'translate(-100px,-100px)',
      filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.35))',
      transition: 'transform 0ms',
    })
    const ring = document.createElement('div')
    ring.id = '__rec_ring'
    Object.assign(ring.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      width: '34px',
      height: '34px',
      marginLeft: '-17px',
      marginTop: '-17px',
      borderRadius: '50%',
      border: '2px solid rgba(125,122,255,.9)',
      zIndex: '2147483646',
      pointerEvents: 'none',
      opacity: '0',
      transform: 'scale(.4)',
    })
    document.documentElement.append(ring, el)
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', install)
  else install()
  new MutationObserver(install).observe(document, {
    childList: true,
    subtree: true,
  })
}

export async function session(name, { theme = 'dark' } = {}) {
  const browser = await chromium.launch()
  const context = await browser.newContext({
    storageState: STATE,
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    colorScheme: theme,
  })
  await context.addInitScript(
    (t) => localStorage.setItem('areca.theme', t),
    theme,
  )
  await context.addInitScript(cursorScript)
  const page = await context.newPage()
  page.setDefaultTimeout(45000)
  let pos = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 }
  let cdp,
    frames = [],
    dir,
    recording = false

  const api = {
    page,
    context,
    async goto(url) {
      await page
        .goto(url, { waitUntil: 'networkidle', timeout: 90000 })
        .catch(() => {})
      await page.evaluate(({ x, y }) => {
        const el = document.getElementById('__rec_cursor')
        if (el) el.style.transform = `translate(${x}px,${y}px)`
      }, pos)
    },
    /** Glide the cursor to a point (or element centre) with ease-in-out. */
    async move(target, ms = 700) {
      let { x, y } =
        typeof target === 'string' || target?.boundingBox
          ? await centre(target)
          : target
      await page.evaluate(
        ({ x, y, ms }) => {
          const el = document.getElementById('__rec_cursor')
          if (!el) return
          el.style.transition = `transform ${ms}ms cubic-bezier(.65,0,.35,1)`
          el.style.transform = `translate(${x}px,${y}px)`
        },
        { x, y, ms },
      )
      await page.mouse.move(x, y, { steps: Math.max(8, Math.round(ms / 25)) })
      await page.waitForTimeout(ms * 0.15)
      pos = { x, y }
    },
    async click(target, { ms = 700, pause = 250 } = {}) {
      if (target) await api.move(target, ms)
      await page.evaluate(({ x, y }) => {
        const r = document.getElementById('__rec_ring')
        if (!r) return
        r.style.transition = 'none'
        r.style.left = x + 'px'
        r.style.top = y + 'px'
        r.style.opacity = '1'
        r.style.transform = 'scale(.4)'
        requestAnimationFrame(() => {
          r.style.transition =
            'transform 420ms ease-out, opacity 420ms ease-out'
          r.style.transform = 'scale(1.3)'
          r.style.opacity = '0'
        })
      }, pos)
      await page.mouse.down()
      await page.waitForTimeout(60)
      await page.mouse.up()
      await page.waitForTimeout(pause)
    },
    async type(text, delay = 45) {
      await page.keyboard.type(text, { delay })
    },
    async wait(ms) {
      await page.waitForTimeout(ms)
    },
    async start() {
      dir = join(FRAMES, name)
      rmSync(dir, { recursive: true, force: true })
      mkdirSync(dir, { recursive: true })
      frames = []
      cdp = await context.newCDPSession(page)
      cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
        if (recording) {
          const file = join(
            dir,
            `${String(frames.length).padStart(6, '0')}.jpg`,
          )
          writeFileSync(file, Buffer.from(data, 'base64'))
          frames.push({ file, t: metadata.timestamp })
        }
        cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
      })
      recording = true
      await cdp.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 92,
        maxWidth: 1920,
        maxHeight: 1080,
        everyNthFrame: 1,
      })
    },
    async stop() {
      // Hold the last frame a little so the clip does not end on a cut.
      await page.waitForTimeout(400)
      recording = false
      await cdp.send('Page.stopScreencast').catch(() => {})
      const end = Date.now() / 1000
      mkdirSync(OUT, { recursive: true })
      const lines = []
      frames.forEach((f, i) => {
        const next = frames[i + 1]?.t ?? end
        lines.push(
          `file '${f.file}'`,
          `duration ${Math.max(0.001, next - f.t).toFixed(4)}`,
        )
      })
      lines.push(`file '${frames.at(-1).file}'`)
      writeFileSync(join(dir, 'list.txt'), lines.join('\n'))
      const out = join(OUT, `${name}.mp4`)
      execFileSync('ffmpeg', [
        '-y',
        '-loglevel',
        'error',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        join(dir, 'list.txt'),
        '-vf',
        'scale=1920:1080:flags=lanczos,fps=30,format=yuv420p',
        '-c:v',
        'libx264',
        '-preset',
        'slow',
        '-crf',
        '16',
        out,
      ])
      console.log(`clip ${out} (${frames.length} frames)`)
    },
    async shot(file) {
      await page.screenshot({ path: file })
    },
    async close() {
      await browser.close()
    },
  }

  async function centre(target) {
    const loc =
      typeof target === 'string' ? page.locator(target).first() : target
    await loc.waitFor({ state: 'visible' })
    const box = await loc.boundingBox()
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }

  return api
}
