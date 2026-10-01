import { cn } from '#/lib/utils'

/**
 * The product spinner: a thin ring in `currentColor`. Inside buttons prefer
 * `<Button loading>`; lists use skeletons instead.
 */
export function Spinner({
  className,
  size = 16,
  label,
}: {
  className?: string
  size?: number
  label?: string
}) {
  return (
    <svg
      aria-hidden={label ? undefined : 'true'}
      aria-label={label}
      role={label ? 'status' : undefined}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={cn(
        'shrink-0 animate-spin text-current motion-reduce:animate-none',
        className,
      )}
      style={{ animationDuration: '0.8s' }}
    >
      <circle
        cx="8"
        cy="8"
        r="6.25"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.2"
        strokeWidth="1.75"
      />
      <path
        d="M14.25 8A6.25 6.25 0 0 0 8 1.75"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  )
}
