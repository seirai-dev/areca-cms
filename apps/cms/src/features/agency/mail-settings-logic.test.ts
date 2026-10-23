import { describe, expect, it } from 'vitest'

import {
  emailStatusKind,
  emailTimeline,
  isMailFailing,
  mailFieldProblems,
  mailStatusCompactLabel,
  mailStatusLabel,
  nextAttemptNumber,
  parsePort,
  portForEncryption,
  suggestedPort,
  timelineStateLabel,
} from './mail-settings-logic'

describe('suggestedPort', () => {
  it('suggests the usual port per encryption, none for local servers', () => {
    expect(suggestedPort('starttls')).toBe(587)
    expect(suggestedPort('tls')).toBe(465)
    expect(suggestedPort('none')).toBeNull()
  })
})

describe('portForEncryption', () => {
  it('moves a default port to the suggestion for the new encryption', () => {
    expect(portForEncryption(587, 'tls')).toBe(465)
    expect(portForEncryption(465, 'starttls')).toBe(587)
    expect(portForEncryption(25, 'starttls')).toBe(587)
  })

  it('keeps a custom port, such as a local test server on 1025', () => {
    expect(portForEncryption(1025, 'tls')).toBe(1025)
    expect(portForEncryption(1025, 'starttls')).toBe(1025)
  })

  it('keeps the port when switching to None', () => {
    expect(portForEncryption(587, 'none')).toBe(587)
  })
})

describe('parsePort', () => {
  it('accepts whole numbers from 1 to 65535', () => {
    expect(parsePort('587')).toBe(587)
    expect(parsePort(' 1025 ')).toBe(1025)
    expect(parsePort('1')).toBe(1)
    expect(parsePort('65535')).toBe(65535)
  })

  it('rejects out-of-range and non-numeric input', () => {
    expect(parsePort('0')).toBeNull()
    expect(parsePort('65536')).toBeNull()
    expect(parsePort('587.5')).toBeNull()
    expect(parsePort('abc')).toBeNull()
    expect(parsePort('')).toBeNull()
  })
})

describe('emailStatusKind', () => {
  it('maps the outbox fields to one status', () => {
    expect(emailStatusKind({ status: 'sent', retrying: false })).toBe('sent')
    expect(emailStatusKind({ status: 'failed', retrying: false })).toBe(
      'failed',
    )
    expect(emailStatusKind({ status: 'queued', retrying: true })).toBe(
      'retrying',
    )
    expect(emailStatusKind({ status: 'queued', retrying: false })).toBe(
      'queued',
    )
    expect(emailStatusKind({ status: 'sending', retrying: false })).toBe(
      'queued',
    )
  })
})

describe('nextAttemptNumber', () => {
  it('counts the next attempt and never exceeds three', () => {
    expect(nextAttemptNumber(1)).toBe(2)
    expect(nextAttemptNumber(2)).toBe(3)
    expect(nextAttemptNumber(3)).toBe(3)
  })
})

describe('emailTimeline', () => {
  it('shows a queued email as the current first dot', () => {
    expect(
      emailTimeline({ status: 'queued', retrying: false, attempts: 0 }),
    ).toEqual([
      { key: 'queued', state: 'current' },
      { key: 'retrying', state: 'pending' },
      { key: 'sent', state: 'pending' },
    ])
  })

  it('marks the retry dot as current while retrying', () => {
    expect(
      emailTimeline({ status: 'queued', retrying: true, attempts: 1 }),
    ).toEqual([
      { key: 'queued', state: 'done' },
      { key: 'retrying', state: 'current' },
      { key: 'sent', state: 'pending' },
    ])
  })

  it('skips the retry dot when the first attempt succeeded', () => {
    expect(
      emailTimeline({ status: 'sent', retrying: false, attempts: 1 }),
    ).toEqual([
      { key: 'queued', state: 'done' },
      { key: 'retrying', state: 'skipped' },
      { key: 'sent', state: 'done' },
    ])
  })

  it('ends a failed email on the failed dot after its retries', () => {
    expect(
      emailTimeline({ status: 'failed', retrying: false, attempts: 3 }),
    ).toEqual([
      { key: 'queued', state: 'done' },
      { key: 'retrying', state: 'done' },
      { key: 'failed', state: 'failed' },
    ])
  })
})

describe('mailStatusLabel', () => {
  it('names the attempt that comes next while retrying', () => {
    expect(
      mailStatusLabel({ status: 'queued', retrying: true, attempts: 1 }),
    ).toContain('2')
    expect(
      mailStatusLabel({ status: 'queued', retrying: true, attempts: 1 }),
    ).toContain('3')
  })

  it('labels the terminal states', () => {
    expect(
      mailStatusLabel({ status: 'sent', retrying: false, attempts: 1 }),
    ).toBe('Sent')
    expect(
      mailStatusLabel({ status: 'failed', retrying: false, attempts: 3 }),
    ).toBe('Failed')
  })
})

describe('isMailFailing', () => {
  it('warns from three consecutive failures', () => {
    expect(isMailFailing({ consecutiveFailures: 0 })).toBe(false)
    expect(isMailFailing({ consecutiveFailures: 2 })).toBe(false)
    expect(isMailFailing({ consecutiveFailures: 3 })).toBe(true)
  })
})

describe('mailFieldProblems', () => {
  const valid = {
    host: 'smtp.example.com',
    port: '587',
    fromAddress: 'cms@example.com',
  }

  it('is empty when every save rule passes', () => {
    expect(mailFieldProblems(valid)).toEqual([])
  })

  it('accepts a From with a display name, as the server does', () => {
    expect(
      mailFieldProblems({
        ...valid,
        fromAddress: 'Areca Review <review@areca.local>',
      }),
    ).toEqual([])
  })

  it('lists the blocking fields in form order, and counts empty ones', () => {
    expect(
      mailFieldProblems({ host: ' ', port: '0', fromAddress: '' }),
    ).toEqual(['host', 'port', 'fromAddress'])
    expect(
      mailFieldProblems({ ...valid, fromAddress: 'not-an-address' }),
    ).toEqual(['fromAddress'])
  })
})

describe('mailStatusCompactLabel', () => {
  it('shortens only the retrying status, to the attempt and the limit', () => {
    expect(
      mailStatusCompactLabel({ status: 'queued', retrying: true, attempts: 1 }),
    ).toBe('Retrying 2/3')
  })

  it('keeps the other statuses as they are', () => {
    expect(
      mailStatusCompactLabel({ status: 'sent', retrying: false, attempts: 1 }),
    ).toBe('Sent')
  })
})

describe('timelineStateLabel', () => {
  it('says in words what each dot state means', () => {
    expect(timelineStateLabel('done')).toBe('done')
    expect(timelineStateLabel('skipped')).toBe('not needed')
    expect(timelineStateLabel('failed')).toBe('stopped')
  })
})
