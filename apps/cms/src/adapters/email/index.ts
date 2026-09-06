import nodemailer from 'nodemailer'

export async function sendEmail(opts: {
  to: string
  subject: string
  text: string
  html?: string
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
    from,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
  })
}
