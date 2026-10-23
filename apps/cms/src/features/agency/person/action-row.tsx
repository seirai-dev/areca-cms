import type { ReactNode } from 'react'

/**
 * One line of a settings card: a title and one sentence on the left, a single
 * control on the right. Stacks on phones so the control keeps its width.
 */
export function ActionRow({
  title,
  description,
  action,
  danger = false,
  testId,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  danger?: boolean
  testId?: string
}) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-border-default py-4 first:border-t-0 first:pt-0 last:pb-0"
      data-testid={testId}
    >
      <div className="grid min-w-0 flex-1 gap-0.5">
        <p
          className={
            danger
              ? 'text-[14px] leading-5 font-medium text-text-error'
              : 'text-[14px] leading-5 font-medium text-text-primary'
          }
        >
          {title}
        </p>
        {description ? (
          <p className="text-callout text-text-secondary">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
