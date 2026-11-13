/**
 * Whether a signed-in user may see agency-wide data (every site and the
 * organization count). Agency admins only get it once local MFA is verified
 * for the session (whenever they have two-factor on, or it is required);
 * until then they see what any member of their own organizations sees.
 */
export function hasAgencyWideAccess(input: {
  isAgencyAdmin: boolean
  adminMfaRequired: boolean
  twoFactorEnabled: boolean
  localMfaVerified: boolean
}) {
  if (!input.isAgencyAdmin) return false
  if (!input.adminMfaRequired && !input.twoFactorEnabled) return true
  return input.twoFactorEnabled && input.localMfaVerified
}
