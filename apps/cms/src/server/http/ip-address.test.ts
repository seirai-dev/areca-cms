import { describe, expect, it } from 'vitest'

import { isPrivateNetworkAddress, isPublicAddress } from './ip-address'

describe('isPublicAddress', () => {
  it.each([
    ['93.184.216.34', true],
    ['1.1.1.1', true],
    ['0.0.0.0', false],
    ['0.255.255.255', false],
    ['10.0.0.1', false],
    ['100.64.0.1', false],
    ['100.127.255.255', false],
    ['100.128.0.1', true],
    ['127.0.0.1', false],
    ['169.254.169.254', false],
    ['172.16.0.1', false],
    ['172.31.255.255', false],
    ['172.32.0.1', true],
    ['192.0.0.9', false],
    ['192.0.1.1', true],
    ['192.0.2.1', false],
    ['192.0.3.1', true],
    ['192.168.1.1', false],
    ['198.18.0.1', false],
    ['198.19.255.255', false],
    ['198.20.0.1', true],
    ['198.51.99.1', true],
    ['198.51.100.7', false],
    ['198.51.101.1', true],
    ['203.0.112.1', true],
    ['203.0.113.7', false],
    ['203.0.114.1', true],
    ['224.0.0.1', false],
    ['239.255.255.255', false],
    ['240.0.0.1', false],
    ['255.255.255.255', false],
  ])('IPv4 %s is public: %s', (ip, expected) => {
    expect(isPublicAddress(ip)).toBe(expected)
  })

  it.each([
    ['2606:4700:4700::1111', true],
    ['2a00:1450:4001::200e', true],
    ['::', false],
    ['::1', false],
    ['fc00::1', false],
    ['fd12:3456::1', false],
    ['fe80::1', false],
    ['febf::1', false],
    ['ff02::1', false],
    ['2001:db8::1', false],
    ['2001:0:4136:e378::1', false],
    ['100::1', false],
    ['fec0::1', false],
    ['feff::1', false],
    ['3fff::1', true],
    ['4000::1', false],
  ])('IPv6 %s is public: %s', (ip, expected) => {
    expect(isPublicAddress(ip)).toBe(expected)
  })

  it.each([
    ['::ffff:127.0.0.1', false],
    ['::ffff:169.254.169.254', false],
    ['::ffff:10.1.2.3', false],
    ['::ffff:93.184.216.34', true],
    ['::ffff:5db8:d822', true],
    ['64:ff9b::7f00:1', false],
    ['64:ff9b::5db8:d822', true],
    ['2002:7f00:1::', false],
    ['2002:5db8:d822::', true],
    ['::7f00:1', false],
    ['::127.0.0.1', false],
    ['::a9fe:a9fe', false],
    ['64:ff9b::a9fe:a9fe', false],
    ['64:ff9b::10.0.0.1', false],
    ['2002:a00:1::', false],
    ['2002:c0a8:101::1', false],
  ])('embedded IPv4 in %s: public=%s', (ip, expected) => {
    expect(isPublicAddress(ip)).toBe(expected)
  })

  it('rejects non-IP strings', () => {
    expect(isPublicAddress('example.com')).toBe(false)
    expect(isPublicAddress('')).toBe(false)
    expect(isPublicAddress('999.1.1.1')).toBe(false)
  })
})

describe('isPrivateNetworkAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.5',
    '172.31.255.1',
    '192.168.1.20',
    '169.254.10.10',
    '::1',
    '0:0:0:0:0:0:0:1',
    'fd12:3456::1',
    'fc00::1',
    'fe80::1',
    'febf::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:192.168.1.1',
  ])('%s is on the private network', (ip) => {
    expect(isPrivateNetworkAddress(ip)).toBe(true)
  })

  it.each([
    '8.8.8.8',
    '172.32.0.1',
    '203.0.113.9',
    '100.64.0.1',
    '2606:4700::1111',
    'fec0::1',
    '::',
    '::ffff:8.8.8.8',
    'example.com',
    '',
  ])('%s is not on the private network', (ip) => {
    expect(isPrivateNetworkAddress(ip)).toBe(false)
  })
})
