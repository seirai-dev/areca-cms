/**
 * Reads what the test SMTP server (Mailpit) received. Tests use unique
 * addresses, so the newest message to an address is the one under test.
 */
export type MailpitMail = { subject: string; html: string; text: string }

/**
 * Polls Mailpit for up to five seconds. Null when nothing arrived. Searches by
 * recipient instead of reading the newest page, because every worker shares
 * one inbox.
 */
export async function waitForMail(to: string): Promise<MailpitMail | null> {
  const base = process.env.MAILPIT_URL ?? 'http://localhost:8025'
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const search = encodeURIComponent(`to:"${to}"`)
    const list = (await (
      await fetch(`${base}/api/v1/search?query=${search}`)
    ).json()) as {
      messages?: Array<{ ID: string; To?: Array<{ Address?: string }> }>
    }
    const hit = list.messages?.find((message) =>
      message.To?.some((address) => address.Address === to),
    )
    if (hit) {
      const full = (await (
        await fetch(`${base}/api/v1/message/${hit.ID}`)
      ).json()) as { Subject?: string; HTML?: string; Text?: string }
      return {
        subject: full.Subject ?? '',
        html: full.HTML ?? '',
        text: full.Text ?? '',
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return null
}
