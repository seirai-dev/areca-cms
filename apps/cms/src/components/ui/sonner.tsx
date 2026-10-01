import { Toaster as Sonner } from 'sonner'
import type { ToasterProps } from 'sonner'
import { useTheme } from 'next-themes'
import {
  CheckCircle,
  Info,
  Warning,
  WarningOctagon,
} from '@phosphor-icons/react'

import { useOverlayState } from '#/components/ui/overlay-registry'
import { Spinner } from '#/components/ui/spinner'

/** Gap kept between toasts and whatever they avoid. */
const EDGE = 20
/** A floating bar's height plus its 16px bottom margin. */
const BAR_CLEARANCE = 64
/** The mobile tab bar plus breathing room. */
const MOBILE_BOTTOM = 88

/**
 * Toasts, themed onto the tokens (see `[data-sonner-toaster]` in styles.css)
 * and following the resolved theme rather than the OS, so a user who picked
 * Dark in the account menu gets dark toasts.
 *
 * Toasts keep clear of other floating surfaces: they sit left of an open
 * slide-over, move to the top while a bottom sheet is open, and rise above
 * a floating bar (save pill, selection bar).
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedTheme } = useTheme()
  const overlays = useOverlayState()
  const bottom = EDGE + (overlays.bar ? BAR_CLEARANCE : 0)
  return (
    <Sonner
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      className="toaster group"
      position={overlays.sheet ? 'top-center' : 'bottom-right'}
      offset={
        overlays.sheet
          ? { top: EDGE }
          : { bottom, right: EDGE + overlays.panelWidth }
      }
      mobileOffset={
        overlays.sheet
          ? { top: 16 }
          : { bottom: MOBILE_BOTTOM + (overlays.bar ? BAR_CLEARANCE : 0) }
      }
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
