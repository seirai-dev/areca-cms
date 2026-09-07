import { expect, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const QA_PASSWORD = 'Password123!'
export const SCREENSHOT_DIR = 'D:\\Code\\areca-cms\\qa-screenshots'
export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')

export function readDemoSiteToken() {
  try {
    const env = readFileSync(
      join(REPO_ROOT, 'examples', 'demo-site', '.env.local'),
      'utf8',
    )
    return env.match(/^ARECA_SITE_TOKEN=(.+)$/m)?.[1]?.trim() ?? ''
  } catch {
    return ''
  }
}

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

export async function screenshot(page: Page, name: string) {
  shot += 1
  const file = `${String(shot).padStart(2, '0')}-${name}.png`
  mkdirSync(SCREENSHOT_DIR, { recursive: true })
  await page.screenshot({
    path: join(SCREENSHOT_DIR, file),
    fullPage: true,
  })
  return file
}

export async function qaLogin(
  page: Page,
  email: string,
  password = QA_PASSWORD,
) {
  await page.goto('/login')
  await expect(page.locator('form[data-ready="true"]')).toBeVisible()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page
    .locator('form[data-ready="true"]')
    .getByRole('button', { name: 'Sign in' })
    .click()
  await expect(page).toHaveURL('/', { timeout: 15_000 })
}

export function datetimeLocalMinutesAgo(minutes: number) {
  const date = new Date(Date.now() - minutes * 60_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

type MailpitMessage = {
  ID: string
  Subject: string
  To: Array<{ Address?: string }>
}

export async function waitForInviteLink(email: string) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const list = await fetch('http://localhost:8025/api/v1/messages')
    if (list.ok) {
      const body = (await list.json()) as { messages?: MailpitMessage[] }
      const match = (body.messages ?? []).find(
        (msg) =>
          msg.Subject.includes('Invitation to') &&
          msg.To.some((to) => to.Address === email),
      )
      if (match) {
        const detail = await fetch(
          `http://localhost:8025/api/v1/message/${match.ID}`,
        )
        const full = (await detail.json()) as { HTML?: string; Text?: string }
        const href =
          (full.HTML ?? full.Text ?? '').match(
            /https?:\/\/[^\s"'<>]+\/invite\/[A-Za-z0-9_-]+/,
          )?.[0] ?? null
        if (href) return href
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Invite email for ${email} not found in Mailpit`)
}

export async function waitForSavedDraft(page: Page) {
  await expect(page.getByText('Draft saved').first()).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByTestId('entry-status')).not.toHaveAttribute(
    'data-status',
    'unsaved',
    { timeout: 15_000 },
  )
  await expect(page.getByTestId('entry-editor')).toHaveAttribute(
    'data-ready',
    'true',
    { timeout: 15_000 },
  )
  await expect(page).toHaveURL(/\/c\/[^/]+\/(?!new(?:\/|$))[^/]+$/, {
    timeout: 15_000,
  })
}

export async function openAcmeSite(page: Page) {
  await page.getByTestId('sites-nav').getByRole('link', { name: /Acme Site/ }).click()
  await expect(page.getByTestId('release-status')).toBeVisible()
  await expect(page.getByTestId('site-content')).toHaveAttribute(
    'data-ready',
    'true',
    { timeout: 15_000 },
  )
}
