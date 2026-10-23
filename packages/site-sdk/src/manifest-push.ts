import { confirm, isCancel } from '@clack/prompts'
import { type ArecaClient, FieldDropsRequiredError, type FieldDrop } from './client.js'
import type { SiteContentConfig } from './types.js'

export type ManifestPushOptions = {
  config: SiteContentConfig
  client: ArecaClient
  /** Field removals confirmed up front, as `<key>.<field>` (`--confirm-drop`). */
  confirmDropFields?: string[]
  /** Accepts every field removal the CMS lists (`--yes`). */
  yes?: boolean
  /** Overrides the TTY check (tests). */
  interactive?: boolean
}

/** `<key>.<field>`, the form the CMS and `--confirm-drop` use. */
export function dropId(drop: Pick<FieldDrop, 'key' | 'field'>): string {
  return `${drop.key}.${drop.field}`
}

/**
 * Pushes the config. When the CMS refuses because a removed field still holds
 * content, the listed drops are shown, then confirmed by a y/N prompt on a TTY,
 * by `--yes`, or by `--confirm-drop`. Anything unconfirmed aborts the push
 * with nothing written.
 */
export async function pushManifest(options: ManifestPushOptions): Promise<void> {
  const interactive = options.interactive ?? Boolean(process.stdin.isTTY)
  const confirmed = new Set(options.confirmDropFields ?? [])

  // Each round confirms at least one new drop, so the loop ends.
  for (;;) {
    try {
      await options.client.syncManifest(options.config, {
        confirmDropFields: [...confirmed],
      })
      return
    } catch (error) {
      if (!(error instanceof FieldDropsRequiredError)) throw error
      const pending = error.drops.filter((drop) => !confirmed.has(dropId(drop)))
      if (pending.length === 0) throw error

      console.log('This push removes fields that still hold content:')
      for (const drop of pending) {
        console.log(`  - ${dropId(drop)}: ${describeEntries(drop.entries)} lose${drop.entries === 1 ? 's' : ''} this field's content`)
      }

      if (options.yes !== true) {
        const ids = pending.map(dropId).join(', ')
        if (!interactive) {
          throw new Error(
            `Removing ${ids} deletes content. Re-run with --confirm-drop <key.field> for each, or --yes to accept. Nothing was pushed.`,
          )
        }
        const answer = await confirm({
          message: `Delete the content of ${ids} and push?`,
          initialValue: false,
        })
        if (isCancel(answer) || answer !== true) {
          throw new Error('Push aborted: the field removal was not confirmed. Nothing was pushed.')
        }
      }
      for (const drop of pending) confirmed.add(dropId(drop))
    }
  }
}

function describeEntries(count: number): string {
  return count === 1 ? '1 entry' : `${count} entries`
}
