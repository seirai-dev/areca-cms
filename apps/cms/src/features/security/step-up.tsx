import * as React from 'react'

import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { FormField } from '#/components/ui/form-field'
import { Input } from '#/components/ui/input'
import { REAUTH_REQUIRED, securityErrorCode } from '#/lib/security-errors'
import { m } from '#/paraglide/messages'
import { verifyStepUpFn } from '#/server/fn/security'

type Pending = {
  resolve: () => void
  reject: () => void
}

type StepUp = {
  /**
   * Runs a sensitive action. If the server answers `REAUTH_REQUIRED`, asks
   * for an authenticator code, verifies it and retries the action once. A
   * dismissed dialog rejects with the original error.
   */
  run: <T>(action: () => Promise<T>) => Promise<T>
}

const StepUpContext = React.createContext<StepUp | null>(null)

export function useStepUp(): StepUp {
  const value = React.useContext(StepUpContext)
  if (!value) throw new Error('useStepUp needs a <StepUpProvider>')
  return value
}

/** Mounts the single re-verification dialog behind `useStepUp().run`. */
export function StepUpProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = React.useState<Pending | null>(null)

  const askForCode = React.useCallback(
    () =>
      new Promise<void>((resolve, reject) => {
        setPending({ resolve, reject })
      }),
    [],
  )

  const value = React.useMemo<StepUp>(
    () => ({
      async run(action) {
        try {
          return await action()
        } catch (error) {
          if (securityErrorCode(error) !== REAUTH_REQUIRED) throw error
          try {
            await askForCode()
          } catch {
            throw error
          }
          return action()
        }
      },
    }),
    [askForCode],
  )

  function settle(ok: boolean) {
    pending?.[ok ? 'resolve' : 'reject']()
    setPending(null)
  }

  return (
    <StepUpContext.Provider value={value}>
      {children}
      <StepUpDialog
        open={pending !== null}
        onVerified={() => settle(true)}
        onCancel={() => settle(false)}
      />
    </StepUpContext.Provider>
  )
}

function StepUpDialog({
  open,
  onVerified,
  onCancel,
}: {
  open: boolean
  onVerified: () => void
  onCancel: () => void
}) {
  const [code, setCode] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setCode('')
      setError(null)
    }
  }, [open])

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await verifyStepUpFn({ data: { code } })
      onVerified()
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : m.step_up_invalid_code(),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent size="sm" data-testid="step-up-dialog">
        <DialogHeader>
          <DialogTitle>{m.step_up_title()}</DialogTitle>
          <DialogDescription>{m.step_up_description()}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <FormField
            label={m.step_up_code()}
            htmlFor="step-up-code"
            error={error ?? undefined}
          >
            <Input
              id="step-up-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              {m.shared_cancel()}
            </Button>
            <Button type="submit" loading={busy} disabled={code.length < 6}>
              {m.step_up_confirm()}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
