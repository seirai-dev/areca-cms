/** A client's tabs. The route validates `?tab=` against it. */
export const CLIENT_TABS = [
  'sites',
  'people',
  'deployment',
  'settings',
] as const
export type ClientTab = (typeof CLIENT_TABS)[number]
