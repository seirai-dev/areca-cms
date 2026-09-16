import { useEffect, useState } from 'react'
import { Check, Copy, KeyRound } from 'lucide-react'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { m } from '#/paraglide/messages'

export function TokenAlert({
  token,
  onDismiss,
}: {
  token: string
  onDismiss?: () => void
}) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) {
      return
    }
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])

  async function copy() {
    try {
      await navigator.clipboard.writeText(token)
      setCopied(true)
      toast.success(m.admin_token_copied())
    } catch {
      toast.error(m.admin_token_copy_error())
    }
  }

  return (
    <Alert data-testid="site-token-alert">
      <KeyRound />
      <AlertTitle>{m.admin_token_title()}</AlertTitle>
      <AlertDescription className="grid gap-3">
        <p>
          {m.admin_token_body_before()}{' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
            ARECA_SITE_TOKEN
          </code>{' '}
          {m.admin_token_body_after()}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
          <pre className="min-w-0 flex-1 overflow-x-auto rounded-md border bg-muted px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all select-all">
            <code data-testid="site-token-value">{token}</code>
          </pre>
          <div className="flex shrink-0 items-start gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void copy()}
              aria-label={m.admin_token_copy_aria()}
            >
              {copied ? <Check /> : <Copy />}
              {copied ? m.admin_token_copied_label() : m.admin_token_copy()}
            </Button>
            {onDismiss ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={onDismiss}
              >
                {m.admin_token_dismiss()}
              </Button>
            ) : null}
          </div>
        </div>
      </AlertDescription>
    </Alert>
  )
}
