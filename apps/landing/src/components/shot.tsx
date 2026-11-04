// A CMS screenshot in a quiet frame. Both themes are in the markup and CSS
// shows the one that matches the page, so toggling the theme swaps it too.
export function Shot({
  name,
  alt,
  eager = false,
  className = '',
}: {
  name: string
  alt: string
  eager?: boolean
  className?: string
}) {
  const common = {
    width: 2880,
    height: 1800,
    loading: eager ? ('eager' as const) : ('lazy' as const),
    decoding: 'async' as const,
    className: 'block h-auto w-full',
  }
  return (
    <div
      className={`overflow-hidden rounded-[14px] border border-line bg-sunken shadow-[var(--shadow-frame)] ${className}`}
    >
      <img
        src={`/shots/${name}-dark.webp`}
        alt={alt}
        {...common}
        className={`${common.className} only-dark`}
      />
      <img
        src={`/shots/${name}-light.webp`}
        alt={alt}
        {...common}
        className={`${common.className} only-light`}
      />
    </div>
  )
}
