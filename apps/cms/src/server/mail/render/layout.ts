import {
  DEFAULT_ACCENT,
  contrastRatio,
  fontEntry,
  normalizeHex,
} from '#/lib/branding'

import type { MailBrand } from './types.ts'

export type LayoutInput = {
  brand: MailBrand
  /** Preview text shown next to the subject in some clients. */
  preheader: string
  heading: string
  paragraphs: string[]
  /** Short lines shown as a compact list under the paragraphs. */
  list?: string[]
  button?: { label: string; url: string }
  /** Small grey lines under the card. The app name is added last. */
  footer: string[]
  /** Small links under the footer lines, separated by a dot. */
  footerLinks?: { label: string; url: string }[]
  /** Language of the message, for the html lang attribute. */
  lang: string
}

export type LayoutOutput = { html: string; text: string }

const TEXT = '#18181b'
const BODY_TEXT = '#3f3f46'
const MUTED = '#71717a'
const PAGE = '#f4f4f5'
const CARD = '#ffffff'
const DARK_TEXT = '#111111'

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** White or near-black button text, whichever reads better on the accent. */
export function buttonTextColor(accent: string) {
  const white = contrastRatio('#ffffff', accent) ?? 0
  const dark = contrastRatio(DARK_TEXT, accent) ?? 0
  return white >= dark ? '#ffffff' : DARK_TEXT
}

function accentFor(brand: MailBrand) {
  return normalizeHex(brand.accentColor ?? '') ?? DEFAULT_ACCENT
}

/**
 * One branded, table-based HTML email plus its plain-text part. Every value is
 * escaped. Light by default; clients that honour `prefers-color-scheme: dark`
 * get a dark card with matching text, divider and muted colours.
 */
export function renderLayout(input: LayoutInput): LayoutOutput {
  const { brand } = input
  const appName = escapeHtml(brand.appName)
  const accent = accentFor(brand)
  const font = escapeHtml(
    `${fontEntry(brand.font).family}, Arial, Helvetica, sans-serif`,
  )
  const mark = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" height="32" alt="${appName}" style="display:block;height:32px;width:auto;border:0;margin:0 0 24px;">`
    : `<div class="mail-heading" style="font-family:${font};font-size:18px;line-height:24px;font-weight:600;color:${TEXT};margin:0 0 24px;">${appName}</div>`
  const paragraphs = input.paragraphs
    .map(
      (line) =>
        `<p class="mail-text" style="margin:0 0 16px;font-family:${font};font-size:15px;line-height:24px;color:${BODY_TEXT};">${escapeHtml(line)}</p>`,
    )
    .join('')
  const list = input.list?.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">${input.list
        .map(
          (line) =>
            `<tr><td class="mail-text" style="padding:2px 0;font-family:${font};font-size:14px;line-height:22px;color:${BODY_TEXT};">${escapeHtml(line)}</td></tr>`,
        )
        .join('')}</table>`
    : ''
  const button = input.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;"><tr><td style="border-radius:8px;background-color:${accent};"><a href="${escapeHtml(input.button.url)}" style="display:inline-block;padding:12px 20px;font-family:${font};font-size:15px;line-height:20px;font-weight:600;color:${buttonTextColor(accent)};text-decoration:none;border-radius:8px;">${escapeHtml(input.button.label)}</a></td></tr></table>`
    : ''
  const links = input.footerLinks?.length
    ? `<p class="mail-muted" style="margin:0 0 6px;font-family:${font};font-size:12px;line-height:18px;color:${MUTED};">${input.footerLinks
        .map(
          (link) =>
            `<a class="mail-muted" href="${escapeHtml(link.url)}" style="color:${MUTED};text-decoration:underline;">${escapeHtml(link.label)}</a>`,
        )
        .join(' &middot; ')}</p>`
    : ''
  const lineHtml = (line: string) =>
    `<p class="mail-muted" style="margin:0 0 6px;font-family:${font};font-size:12px;line-height:18px;color:${MUTED};">${escapeHtml(line)}</p>`
  // Links sit just above the app name.
  const footer =
    input.footer.map(lineHtml).join('') + links + lineHtml(brand.appName)

  const html = `<!doctype html>
<html lang="${escapeHtml(input.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(input.heading)}</title>
<style>
@media (prefers-color-scheme: dark) {
  .mail-page { background-color: #18181b !important; }
  .mail-card { background-color: #27272a !important; }
  .mail-text, .mail-heading { color: #f4f4f5 !important; }
  .mail-muted { color: #a1a1aa !important; }
  .mail-divider { border-top-color: #3f3f46 !important; }
}
</style>
</head>
<body class="mail-page" style="margin:0;padding:0;background-color:${PAGE};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(input.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="mail-page" style="background-color:${PAGE};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
<tr><td class="mail-card" style="background-color:${CARD};border-radius:12px;padding:24px;">
${mark}
<h1 class="mail-heading" style="margin:0 0 16px;font-family:${font};font-size:20px;line-height:28px;font-weight:600;color:${TEXT};">${escapeHtml(input.heading)}</h1>
${paragraphs}
${list}
${button}
<div class="mail-divider" style="border-top:1px solid #e4e4e7;padding-top:16px;">${footer}</div>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`

  const text = [
    input.heading,
    ...input.paragraphs,
    ...(input.list?.length ? [input.list.map((line) => `- ${line}`).join('\n')] : []),
    ...(input.button ? [`${input.button.label}: ${input.button.url}`] : []),
    [
      ...input.footer,
      ...(input.footerLinks ?? []).map((link) => `${link.label}: ${link.url}`),
      brand.appName,
    ].join('\n'),
  ].join('\n\n')

  return { html, text }
}
