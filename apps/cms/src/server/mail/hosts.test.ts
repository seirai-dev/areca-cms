import { describe, expect, it } from 'vitest'

import {
  defaultSecureFor,
  isInsecureForHost,
  isPrivateMailHost,
} from './hosts.ts'

describe('isPrivateMailHost', () => {
  it.each([
    'localhost',
    'mail.localhost',
    'printer.local',
    'smtp.internal',
    'mailpit',
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.5',
    '172.31.255.1',
    '192.168.1.20',
    '169.254.10.10',
    '::1',
    '[::1]',
    'fd12:3456::1',
    'fe80::1',
  ])('treats %s as private', (host) => {
    expect(isPrivateMailHost(host)).toBe(true)
  })

  it.each([
    'smtp.example.com',
    'smtp.resend.com',
    '8.8.8.8',
    '172.32.0.1',
    '203.0.113.9',
    '2606:4700::1111',
  ])('treats %s as public', (host) => {
    expect(isPrivateMailHost(host)).toBe(false)
  })
})

describe('defaultSecureFor', () => {
  it('uses none for private hosts and starttls otherwise', () => {
    expect(defaultSecureFor('mailpit')).toBe('none')
    expect(defaultSecureFor('localhost')).toBe('none')
    expect(defaultSecureFor('smtp.example.com')).toBe('starttls')
  })
})

describe('isInsecureForHost', () => {
  it('rejects unencrypted SMTP to public hosts only', () => {
    expect(
      isInsecureForHost({ host: 'smtp.example.com', secure: 'none' }),
    ).toBe(true)
    expect(isInsecureForHost({ host: 'mailpit', secure: 'none' })).toBe(false)
    expect(isInsecureForHost({ host: 'smtp.example.com', secure: 'tls' })).toBe(
      false,
    )
  })
})
