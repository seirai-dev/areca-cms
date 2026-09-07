import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'

export function TokenAlert({ token }: { token: string }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(token)
      toast.success('Token copied')
    } catch {
      toast.error('Could not copy token')
    }
  }

  return (
    <Alert data-testid="site-token-alert">
      <AlertTitle>Store this site token</AlertTitle>
      <AlertDescription>
        <p>Store this in the site&apos;s ARECA_SITE_TOKEN. It will not be shown again.</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code
            data-testid="site-token-value"
            className="rounded bg-muted px-2 py-1 break-all"
          >
            {token}
          </code>
          <Button type="button" size="sm" variant="outline" onClick={() => void copy()}>
            Copy
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  )
}
