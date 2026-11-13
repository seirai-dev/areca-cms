import { describe, expect, it } from 'vitest'

import { hasAgencyWideAccess } from './agency-access'

const admin = {
  isAgencyAdmin: true,
  adminMfaRequired: true,
  twoFactorEnabled: true,
  localMfaVerified: true,
}

describe('hasAgencyWideAccess', () => {
  it('grants agency-wide data to a verified admin', () => {
    expect(hasAgencyWideAccess(admin)).toBe(true)
  })

  it('withholds it until local MFA is verified for the session', () => {
    expect(hasAgencyWideAccess({ ...admin, localMfaVerified: false })).toBe(
      false,
    )
  })

  it('withholds it from admins who have not enrolled', () => {
    expect(
      hasAgencyWideAccess({
        ...admin,
        twoFactorEnabled: false,
        localMfaVerified: false,
      }),
    ).toBe(false)
  })

  it('never grants it to non-admins', () => {
    expect(hasAgencyWideAccess({ ...admin, isAgencyAdmin: false })).toBe(false)
  })

  it('does not require verification when admin MFA is switched off', () => {
    expect(
      hasAgencyWideAccess({
        ...admin,
        adminMfaRequired: false,
        twoFactorEnabled: false,
        localMfaVerified: false,
      }),
    ).toBe(true)
  })

  it('still waits for the code when an admin has two-factor on without the requirement', () => {
    expect(
      hasAgencyWideAccess({
        ...admin,
        adminMfaRequired: false,
        localMfaVerified: false,
      }),
    ).toBe(false)
  })
})
