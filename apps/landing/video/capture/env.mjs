// Settings for the capture scripts. They point at a running CMS, so nothing
// about a real install is committed here. See ../README.md for the list.
export function env(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Set ${name} before running the capture scripts.`)
  }
  return value.replace(/\/$/, '')
}

export const CMS = () => env('CMS_URL')
export const SITE = () => `${CMS()}/sites/${env('CAPTURE_SITE_ID')}`
