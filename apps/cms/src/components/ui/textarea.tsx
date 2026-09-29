import * as React from 'react'

import { fieldClasses } from '#/components/ui/input'
import { cn } from '#/lib/utils'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(fieldClasses, 'field-sizing-content min-h-20 py-2', className)}
      {...props}
    />
  )
}

export { Textarea }
