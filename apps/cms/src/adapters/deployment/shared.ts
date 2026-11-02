/** Resolves after `ms` milliseconds. Shared by the deployment adapters. */
export function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}
