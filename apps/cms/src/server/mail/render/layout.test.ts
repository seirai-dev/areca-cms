import { describe, expect, it } from 'vitest'

import { buttonTextColor, escapeHtml, renderLayout } from './layout.ts'
import type { LayoutInput } from './layout.ts'
import type { MailBrand } from './types.ts'

const brand: MailBrand = {
  appName: 'Acme CMS',
  accentColor: null,
  font: 'inter',
  emailFromName: null,
  logoUrl: null,
}

const base: LayoutInput = {
  brand,
  preheader: 'Preview',
  heading: 'Hello',
  paragraphs: ['Body text'],
  footer: ['Footer line'],
  lang: 'en',
}

describe('escapeHtml', () => {
  it('escapes markup and quotes', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    )
  })
})

describe('renderLayout', () => {
  it('escapes every interpolated value in the html part', () => {
    const { html } = renderLayout({
      ...base,
      brand: { ...brand, appName: '<b>App</b>' },
      preheader: '<x>',
      heading: '<script>alert(1)</script>',
      paragraphs: ['"quoted" & <img src=x onerror=1>'],
      button: {
        label: '<i>Go</i>',
        url: 'https://x.test/?a="1"&b=<2>',
      },
      footer: ['</p><a href="evil">'],
    })

    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<b>App</b>')
    expect(html).toContain('&lt;b&gt;App&lt;/b&gt;')
    expect(html).toContain('&quot;quoted&quot; &amp; &lt;img')
    expect(html).toContain(
      'href="https://x.test/?a=&quot;1&quot;&amp;b=&lt;2&gt;"',
    )
    expect(html).toContain('&lt;/p&gt;&lt;a href=&quot;evil&quot;&gt;')
    expect(html).not.toContain('<a href="evil">')
  })

  it('uses the logo when branding has one and the app name otherwise', () => {
    const logo = 'https://cms.test/api/assets/file/logo.png'
    const withLogo = renderLayout({
      ...base,
      brand: { ...brand, logoUrl: logo },
    })
    expect(withLogo.html).toContain(`<img src="${logo}"`)
    expect(withLogo.html).toContain('alt="Acme CMS"')

    const withoutLogo = renderLayout(base)
    expect(withoutLogo.html).not.toContain('<img')
    expect(withoutLogo.html).toContain('>Acme CMS</div>')
  })

  it('colours the button with the brand accent and a readable label', () => {
    const button = { label: 'Go', url: 'https://x.test' }
    const dark = renderLayout({
      ...base,
      brand: { ...brand, accentColor: '#1f1f8f' },
      button,
    })
    expect(dark.html).toContain('background-color:#1f1f8f')
    expect(dark.html).toContain('color:#ffffff;text-decoration:none')

    const light = renderLayout({
      ...base,
      brand: { ...brand, accentColor: '#ffff00' },
      button,
    })
    expect(light.html).toContain('background-color:#ffff00')
    expect(light.html).toContain('color:#111111;text-decoration:none')
  })

  it('falls back to the default accent for an invalid colour', () => {
    const { html } = renderLayout({
      ...base,
      brand: { ...brand, accentColor: 'not-a-colour' },
      button: { label: 'Go', url: 'https://x.test' },
    })
    expect(html).toContain('background-color:#5856d6')
  })

  it('declares dark-mode support and keeps the preheader hidden', () => {
    const { html } = renderLayout({ ...base, preheader: 'Shown in inbox' })
    expect(html).toContain('<meta name="color-scheme" content="light dark">')
    expect(html).toContain('prefers-color-scheme: dark')
    expect(html).toContain('display:none')
    expect(html).toContain('Shown in inbox')
  })

  it('uses the brand font with web-safe fallbacks', () => {
    const { html } = renderLayout(base)
    expect(html).toContain('Arial, Helvetica, sans-serif')
    expect(html).toContain('Inter Variable')
  })

  it('builds a plain-text part with heading, paragraphs, link and footer', () => {
    const { text } = renderLayout({
      ...base,
      button: {
        label: 'Accept invitation',
        url: 'https://x.test/invite/abc',
      },
    })
    expect(text).toBe(
      'Hello\n\nBody text\n\nAccept invitation: https://x.test/invite/abc\n\nFooter line\nAcme CMS',
    )
  })

  it('omits the button from the text part when there is none', () => {
    const { text } = renderLayout(base)
    expect(text).toBe('Hello\n\nBody text\n\nFooter line\nAcme CMS')
  })
})

describe('buttonTextColor', () => {
  it('picks white on dark accents and near-black on light ones', () => {
    expect(buttonTextColor('#5856d6')).toBe('#ffffff')
    expect(buttonTextColor('#ffff00')).toBe('#111111')
  })
})
