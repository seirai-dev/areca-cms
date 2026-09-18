import { Toaster as Sonner } from 'sonner'
import type { ToasterProps } from 'sonner'
import {
  CheckCircle,
  Info,
  CircleNotch,
  WarningOctagon,
  Warning,
} from '@phosphor-icons/react'

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="system"
      className="toaster group"
      icons={{
        success: <CheckCircle className="size-4" />,
        info: <Info className="size-4" />,
        warning: <Warning className="size-4" />,
        error: <WarningOctagon className="size-4" />,
        loading: <CircleNotch className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
