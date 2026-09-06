import { describe, expect, it } from 'vitest'
import { sendEmail } from './index'

describe.skipIf(!process.env.SMTP_HOST)('sendEmail', () => {
  it('delivers a message visible in Mailpit', async () => {
    const subject = `areca-adapter-test-${Date.now()}`
    const to = 'adapter-test@areca.local'

    await sendEmail({ to, subject, text: 'hello from adapter test' })

    const found = await waitForMailpit(subject, to)
    expect(found).toBe(true)
  })
})

async function waitForMailpit(subject: string, to: string) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const res = await fetch('http://localhost:8025/api/v1/messages')
    if (res.ok) {
      const data = (await res.json()) as {
        messages?: Array<{
          Subject?: string
          To?: Array<{ Address?: string }>
        }>
      }
      const hit = data.messages?.some(
        (msg) =>
          msg.Subject === subject &&
          msg.To?.some((addr) => addr.Address === to),
      )
      if (hit) return true
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return false
}
