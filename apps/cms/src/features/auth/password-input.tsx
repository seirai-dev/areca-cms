import * as React from 'react'
import { Eye, EyeSlash } from '@phosphor-icons/react'

import { Input } from '#/components/ui/input'
import { Hint } from '#/components/ui/tooltip'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

/**
 * Password field with a show/hide eye (brief §3.1). The toggle's name is
 * sr-only text rather than `aria-label`, so `getByLabel('Password')` still
 * finds exactly one control: the input.
 */
export function PasswordInput({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, 'type'>) {
  const [visible, setVisible] = React.useState(false)
  const label = visible ? m.auth_hide_password() : m.auth_show_password()
  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? 'text' : 'password'}
        className={cn('pr-11', className)}
      />
      <Hint label={label}>
        <button
          type="button"
          aria-pressed={visible}
          data-testid="password-visibility"
          onClick={() => setVisible((value) => !value)}
          className="absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 place-content-center rounded-[8px] text-icon-muted transition-colors outline-none hover:bg-surface-state-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-border-focus"
        >
          {visible ? (
            <EyeSlash className="size-[18px]" />
          ) : (
            <Eye className="size-[18px]" />
          )}
          <span className="sr-only">{label}</span>
        </button>
      </Hint>
    </div>
  )
}
