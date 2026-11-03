export function LogoMark({ size = 64 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size}>
      <rect width="32" height="32" rx="8" fill="#5856D6" />
      <path
        d="M24 8C14 8 9.5 13.5 9.5 20c0 1 .1 1.8.4 2.6L7.3 25.2l1.5 1.5 2.6-2.6c.8.3 1.6.4 2.6.4C20.5 24.5 24 19 24 8z"
        fill="#fff"
      />
    </svg>
  )
}
