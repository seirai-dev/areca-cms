/** Actors and policies of the authorization matrix (import-free, so the doc generator can read them). */
export type ActorName =
  | 'anonymous'
  | 'editorX'
  | 'ownerX'
  | 'ownerY'
  | 'adminNoMfa'
  | 'adminMfa'
  | 'adminStale'

export const ACTORS: ActorName[] = [
  'anonymous',
  'editorX',
  'ownerX',
  'ownerY',
  'adminNoMfa',
  'adminMfa',
  'adminStale',
]

/** What a caller is expected to get back. */
export type Expected =
  'allowed' | 'login' | 'forbidden' | 'not-found' | 'mfa' | 'reauth'

export type Policy =
  'public' | 'user' | 'org-editor' | 'org-owner' | 'agency' | 'agency-fresh'

const ALL = (value: Expected): Record<ActorName, Expected> => ({
  anonymous: value,
  editorX: value,
  ownerX: value,
  ownerY: value,
  adminNoMfa: value,
  adminMfa: value,
  adminStale: value,
})

/**
 * Expected result per policy. "X" is the organization whose data the call
 * targets; "Y" is an unrelated tenant.
 */
export const POLICY_EXPECTATIONS: Record<
  Policy,
  Record<ActorName, Expected>
> = {
  public: ALL('allowed'),
  user: { ...ALL('allowed'), anonymous: 'login' },
  'org-editor': {
    anonymous: 'login',
    editorX: 'allowed',
    ownerX: 'allowed',
    ownerY: 'forbidden',
    adminNoMfa: 'mfa',
    adminMfa: 'allowed',
    adminStale: 'allowed',
  },
  'org-owner': {
    anonymous: 'login',
    editorX: 'forbidden',
    ownerX: 'allowed',
    ownerY: 'forbidden',
    adminNoMfa: 'mfa',
    adminMfa: 'allowed',
    adminStale: 'allowed',
  },
  agency: {
    anonymous: 'login',
    editorX: 'forbidden',
    ownerX: 'forbidden',
    ownerY: 'forbidden',
    adminNoMfa: 'mfa',
    adminMfa: 'allowed',
    adminStale: 'allowed',
  },
  'agency-fresh': {
    anonymous: 'login',
    editorX: 'forbidden',
    ownerX: 'forbidden',
    ownerY: 'forbidden',
    adminNoMfa: 'mfa',
    adminMfa: 'allowed',
    adminStale: 'reauth',
  },
}
