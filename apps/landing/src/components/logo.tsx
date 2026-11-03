// The Areca mark from the CMS favicon: a leaf on an iris tile.
export function LogoMark({ className = 'size-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#5856D6" />
      <path
        d="M24 8C14 8 9.5 13.5 9.5 20c0 1 .1 1.8.4 2.6L7.3 25.2l1.5 1.5 2.6-2.6c.8.3 1.6.4 2.6.4C20.5 24.5 24 19 24 8z"
        fill="#fff"
      />
    </svg>
  )
}

export function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className="text-[1.1875rem] font-semibold tracking-[-0.03em]">
        Areca
      </span>
    </span>
  )
}
