import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MailConfig, MailMessage } from './types.ts'

type FakeTransport = {
  sendMail: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
}

const created = vi.hoisted(() => ({
  transports: [] as FakeTransport[],
  fail: false,
}))

vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => {
      const transport = {
        sendMail: vi.fn(async () => {
          if (created.fail) throw new Error('boom')
          return { messageId: 'id' }
        }),
        close: vi.fn(),
      }
      created.transports.push(transport)
      return transport
    },
  },
}))

const { closeMailPools, sendMail } = await import('./transport.ts')

const config: MailConfig = {
  source: 'settings',
  host: 'smtp.example.com',
  port: 587,
  secure: 'starttls',
  username: 'user',
  password: 'secret',
  from: 'cms@example.com',
  replyTo: null,
}
const message: MailMessage = {
  from: 'cms@example.com',
  to: 'a@example.com',
  subject: 'Hi',
  text: 'Hi',
  html: '<p>Hi</p>',
}

afterEach(() => {
  closeMailPools()
  created.transports.length = 0
  created.fail = false
})

describe('sendMail pooling', () => {
  it('reuses one transport for sends with the same configuration', async () => {
    await sendMail(config, message)
    await sendMail(config, message)
    expect(created.transports).toHaveLength(1)
    expect(created.transports[0].sendMail).toHaveBeenCalledTimes(2)
  })

  it('opens another transport when the configuration changes', async () => {
    await sendMail(config, message)
    await sendMail({ ...config, password: 'changed' }, message)
    expect(created.transports).toHaveLength(2)
  })

  it('closes a transport after a failed send and opens a fresh one', async () => {
    created.fail = true
    await expect(sendMail(config, message)).rejects.toThrow('boom')
    expect(created.transports[0].close).toHaveBeenCalled()
    created.fail = false
    await sendMail(config, message)
    expect(created.transports).toHaveLength(2)
  })

  it('closes an idle transport', async () => {
    vi.useFakeTimers()
    try {
      await sendMail(config, message)
      expect(created.transports[0].close).not.toHaveBeenCalled()
      vi.advanceTimersByTime(10_000)
      expect(created.transports[0].close).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
