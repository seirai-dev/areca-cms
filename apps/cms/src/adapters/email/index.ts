import nodemailer from 'nodemailer'

/**
 * Builds the `From` header. `SMTP_FROM` may be a bare address or already
 * carry a display name; a branded name replaces any existing one.
 */
export function formatFrom(from: string, fromName?: string | null) {
  const name = fromName?.trim().replace(/["\r\n<>]/g, '')
  if (!name) return from
  const match = from.match(/<([^>]+)>/)
  const address = (match ? match[1] : from).trim()
  return `"${name}" <${address}>`
}

export async function sendEmail(opts: {
  to: string
  subject: string
  text: string
  html?: string
  fromName?: string | null
}): Promise<void> {
  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT)
  const from = process.env.SMTP_FROM
  if (!host || !from || !Number.isFinite(port)) {
    throw new Error('SMTP_HOST, SMTP_PORT, and SMTP_FROM are required')
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: false,
  })

  await transporter.sendMail({
    from: formatFrom(from, opts.fromName),
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
  })
}
