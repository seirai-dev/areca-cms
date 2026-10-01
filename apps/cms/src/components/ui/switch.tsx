import * as React from 'react'
import { Switch as SwitchPrimitive } from 'radix-ui'

import { cn } from '#/lib/utils'

/** iOS-style switch: accent track when on, white thumb with a soft shadow. */
function Switch({
  className,
  size = 'default',
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: 'sm' | 'default'
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        'peer group/switch relative inline-flex shrink-0 cursor-pointer items-center rounded-full p-[2px]',
        'transition-colors duration-200 ease-(--ease-standard)',
        'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
        'disabled:cursor-not-allowed disabled:opacity-40',
        'data-[size=default]:h-6 data-[size=default]:w-[42px] data-[size=sm]:h-[18px] data-[size=sm]:w-8',
        'data-[state=checked]:bg-accent data-[state=unchecked]:bg-[color-mix(in_oklab,var(--color-text-primary)_16%,transparent)]',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'pointer-events-none block rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.2),0_0_0_0.5px_rgb(0_0_0/0.04)]',
          'transition-transform duration-200 ease-[cubic-bezier(0.3,1.4,0.5,1)]',
          'group-data-[size=default]/switch:size-5 group-data-[size=sm]/switch:size-3.5',
          'data-[state=unchecked]:translate-x-0',
          'group-data-[size=default]/switch:data-[state=checked]:translate-x-[18px] group-data-[size=sm]/switch:data-[state=checked]:translate-x-[14px]',
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
