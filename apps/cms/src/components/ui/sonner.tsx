import { Toaster as Sonner } from 'sonner'
import type { ToasterProps } from 'sonner'
import { useTheme } from 'next-themes'
import {
  CheckCircle,
  Info,
  Warning,
  WarningOctagon,
} from '@phosphor-icons/react'

import { Spinner } from '#/components/ui/spinner'

/**
 * Toasts, themed onto the tokens (see `[data-sonner-toaster]` in styles.css)
 * and following the resolved theme rather than the OS, so a user who picked
 * Dark in the account menu gets dark toasts.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedTheme } = useTheme()
  return (
    <Sonner
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      className="toaster group"
      position="bottom-right"
      offset={20}
      mobileOffset={{ bottom: 88 }}
      gap={10}
      icons={{
        success: <CheckCircle weight="fill" className="size-[18px]" />,
        info: <Info weight="fill" className="size-[18px]" />,
        warning: <Warning weight="fill" className="size-[18px]" />,
        error: <WarningOctagon weight="fill" className="size-[18px]" />,
        loading: <Spinner size={16} />,
      }}
      toastOptions={{
        classNames: {
          toast: 'font-sans! text-[13.5px]!',
          title: 'font-semibold!',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
