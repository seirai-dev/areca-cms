import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'

export const CMS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * Where the walkthrough writes its screenshots and ISSUES.md. Override with
 * `QA_SCREENSHOT_DIR` (absolute, or relative to apps/cms). Note that
 * Playwright empties `test-results/` at the start of every run.
 */
export const SCREENSHOT_DIR = (() => {
  const dir = process.env.QA_SCREENSHOT_DIR ?? 'test-results/qa-screens'
  return isAbsolute(dir) ? dir : resolve(CMS_ROOT, dir)
})()

export const QA_PASSWORD = 'Password123!'

export const QA_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAn0lEQVRoge2SQQkAQRDDqiTCqmTln4h7hIFCBKSh4fU00Q3YgOoV2YV6l+gGbED1iuxCvUt0AzagekV2od4lugEbUL0iu1DvEt2ADahekV2od4luwAZUr8gu1LtEN2ADqldkF+pdohuwAdUrsgv1LtEN2IDqFdmFepfoBmxA9YrsQr1LdAM2oHpFdqHeJboBG1C9IrtQ7xLdgA2oXvEPH6VfAOIEM2XXAAAAAElFTkSuQmCC',
  'base64',
)

export type QaIssue = {
  area: string
  severity: 'blocker' | 'functional' | 'visual' | 'docs'
  note: string
}

export const issues: QaIssue[] = []

export function logIssue(issue: QaIssue) {
  issues.push(issue)
  console.log(`[QA ${issue.severity}] ${issue.area}: ${issue.note}`)
}

export function writeIssues() {
  mkdirSync(SCREENSHOT_DIR, { recursive: true })
  writeFileSync(
    join(SCREENSHOT_DIR, 'ISSUES.md'),
    issues.length
      ? issues.map((i) => `- **${i.severity}** (${i.area}): ${i.note}`).join('\n') + '\n'
      : 'No issues logged.\n',
  )
}

let shot = 0

/** A numbered full-page screenshot in SCREENSHOT_DIR. */
export async function screenshot(page: Page, name: string) {
  shot += 1
  const file = `${String(shot).padStart(2, '0')}-${name}.png`
  mkdirSync(SCREENSHOT_DIR, { recursive: true })
  // Let springs and fades settle.
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(SCREENSHOT_DIR, file), fullPage: true })
  return file
}

/**
 * Records uncaught page errors and console errors as QA issues (they do not
 * fail the walkthrough, which is about flows).
 */
export function watchErrors(page: Page, area: string) {
  page.on('pageerror', (error) =>
    logIssue({ area, severity: 'functional', note: `page error: ${error.message}` }),
  )
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    // Expected noise: failed sign-in attempts, aborted fetches on navigation.
    if (/401|Failed to load resource|AbortError/i.test(text)) return
    // Keep the first line plus React's +/- diff lines (hydration mismatches).
    const lines = text.split('\n')
    const diff = lines.filter((line) => /^\s*[+-] /.test(line)).slice(0, 8)
    const note = [lines[0].slice(0, 200), ...diff.map((line) => line.trim().slice(0, 160))].join(' | ')
    logIssue({ area, severity: 'functional', note: `console error: ${note}` })
  })
}
