import { useEffect, useRef } from 'react'
import { X } from '@phosphor-icons/react'
import { m } from '@/paraglide/messages'

// Native <dialog>: focus trapping, Escape and the backdrop come for free.
export function VideoDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const video = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const d = dialog.current
    if (!d) return
    if (open && !d.open) {
      d.showModal()
      void video.current?.play().catch(() => {})
    }
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={dialog}
      aria-label={m.video_dialog_title()}
      onClose={() => {
        video.current?.pause()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === dialog.current) dialog.current.close()
      }}
      className="m-auto w-[min(1200px,calc(100vw-2rem))] max-w-none bg-transparent p-0 text-fg backdrop:bg-black/80 backdrop:backdrop-blur-sm"
    >
      <div className="flex items-center justify-between pb-3">
        <p className="text-small text-white/70">{m.video_caption()}</p>
        <button
          type="button"
          onClick={() => dialog.current?.close()}
          aria-label={m.video_close()}
          className="grid size-9 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
        >
          <X size={18} />
        </button>
      </div>
      <video
        ref={video}
        className="block aspect-video w-full rounded-[14px] bg-black"
        controls
        playsInline
        preload="none"
        poster="/video/poster.webp"
      >
        <source src="/video/areca-tour.webm" type="video/webm" />
        <source src="/video/areca-tour.mp4" type="video/mp4" />
      </video>
    </dialog>
  )
}
