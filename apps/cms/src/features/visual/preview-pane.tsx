import * as React from 'react'
import {
  ArrowClockwise,
  ArrowSquareOut,
  ArrowsInLineHorizontal,
  CornersIn,
  CornersOut,
  DeviceMobile,
  DeviceTablet,
  Monitor,
} from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'
import { Hint } from '#/components/ui/tooltip'
import { Kbd, KbdCombo, useModifierKeys } from '#/components/ui/kbd'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/ui/popover'
import { SegmentedControl } from '#/components/ui/segmented-control'
import type { SegmentedOption } from '#/components/ui/segmented-control'
import { SpinnerRing } from '#/components/ui/status-pill'
import type { EntryData } from '#/lib/types'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

import type { Tier } from './live-channel'
import { useLivePreviewChannel } from './use-live-preview'
import { framePresentation } from './visual-layout'
import type { PreviewWidth } from './visual-layout'
import { useVisualFullScreen } from './visual-context'
import { useVisualPreferences } from './visual-preferences'

/** Gap around a framed (tablet, mobile, fit) preview inside the pane. */
const FRAME_GUTTER_PX = 16
/** Saves within this window reload the frame once. */
export const RELOAD_DEBOUNCE_MS = 800

const SANDBOX =
  'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox'

/** What the live channel needs from the editor: the unsaved entry and the preview origin. */
export type LiveSource = {
  /** The preview site's origin (`previewOrigin(site)`). Null turns the channel off. */
  origin: string | null
  siteId: string
  collection: string
  /** The saved entry. Null (not saved yet) turns the channel off. */
  entryId: string | undefined
  /** The unsaved entry data, every language. */
  data: EntryData
  /** The content language being edited, or null. */
  locale: string | null
}

/**
 * The live preview pane of Visual mode. Tier 2 (live) sends unsaved changes to the
 * page and does not reload it on save. Tier 1 (on-save) reloads after each successful
 * save. Both reload on the Reload button and when the page changes (a new slug).
 * The iframe element never remounts when entering or leaving full screen: only the
 * pane's position classes change, so the page keeps its state.
 */
export function PreviewPane({
  previewUrl,
  title,
  lastSavedAt,
  unavailableReason,
  live,
}: {
  /** The signed preview URL, when the entry has one. */
  previewUrl: string | undefined
  /** The entry title, for the frame's accessible name. */
  title: string
  /** The last successful save. Each new value reloads the frame (unless live). */
  lastSavedAt: Date | null
  /** Why there is no preview yet (Tier 0), or null while it loads. */
  unavailableReason: string | null
  live: LiveSource
}) {
  const { fullScreen, setFullScreen } = useVisualFullScreen()
  const prefs = useVisualPreferences()
  const width = prefs.width
  const keys = useModifierKeys()

  const iframeRef = React.useRef<HTMLIFrameElement>(null)
  const channel = useLivePreviewChannel({
    iframeRef,
    origin: live.origin,
    enabled: Boolean(previewUrl && live.origin && live.entryId),
    siteId: live.siteId,
    collection: live.collection,
    entryId: live.entryId ?? '',
    data: live.data,
    locale: live.locale,
  })
  const frame = useFrameReload({
    previewUrl,
    lastSavedAt,
    live: channel.tier === 'live',
  })
  const stage = useStageSize()

  const presentation = framePresentation(
    width,
    stage.width - (width === 'desktop' ? 0 : FRAME_GUTTER_PX * 2),
    stage.height - (width === 'desktop' ? 0 : FRAME_GUTTER_PX * 2),
  )
  const framed = width !== 'desktop'
  // The label is hidden (not removed) under the pane breakpoint, so the
  // accessible name and tooltip always carry the full name.
  const widthOption = (
    value: PreviewWidth,
    name: string,
    icon: React.ReactNode,
    testId: string,
  ): SegmentedOption<PreviewWidth> => ({
    value,
    label: <span className="hidden @[900px]/preview:inline">{name}</span>,
    icon,
    ariaLabel: name,
    hint: name,
    testId,
  })
  const widthOptions: SegmentedOption<PreviewWidth>[] = [
    widthOption(
      'desktop',
      m.visual_width_desktop(),
      <Monitor />,
      'visual-width-desktop',
    ),
    widthOption(
      'fit1440',
      m.visual_width_fit(),
      <ArrowsInLineHorizontal />,
      'visual-width-fit1440',
    ),
    widthOption(
      'tablet',
      m.visual_width_tablet(),
      <DeviceTablet />,
      'visual-width-tablet',
    ),
    widthOption(
      'mobile',
      m.visual_width_mobile(),
      <DeviceMobile />,
      'visual-width-mobile',
    ),
  ]

  const widthControl = (
    <SegmentedControl
      hintSide="bottom"
      size="sm"
      value={width}
      onValueChange={prefs.setWidth}
      options={widthOptions}
      aria-label={m.visual_width_group()}
      data-testid="visual-width"
      className="max-w-full overflow-x-auto"
    />
  )

  const reloadButton = (
    <Hint label={m.visual_reload()} side="bottom">
      <Button
        type="button"
        variant="quiet"
        size="icon-sm"
        onClick={frame.reload}
        aria-label={m.visual_reload()}
        data-testid="visual-reload"
      >
        <ArrowClockwise />
      </Button>
    </Hint>
  )

  const frameStage = (
    <div
      ref={stage.ref}
      className={cn(
        'min-h-0 min-w-0',
        fullScreen ? 'absolute inset-x-0 top-16 bottom-0' : 'relative flex-1',
        // The framed presets sit on a backdrop; the desktop frame fills it.
        framed && 'bg-background-subtle',
      )}
    >
      <div
        className={cn(
          'absolute inset-0 flex items-center justify-center',
          framed ? 'p-4' : undefined,
        )}
      >
        <div
          data-testid="visual-frame-box"
          className={cn(
            'relative shrink-0 overflow-hidden bg-background-surface',
            framed &&
              'rounded-[12px] border border-border-default shadow-float',
          )}
          style={{
            width: presentation.width * presentation.scale,
            height: presentation.height * presentation.scale,
          }}
        >
          <div
            className="relative"
            style={{
              width: presentation.width,
              height: presentation.height,
              transform:
                presentation.scale === 1
                  ? undefined
                  : `scale(${presentation.scale})`,
              transformOrigin: 'top left',
            }}
          >
            {frame.src ? (
              <iframe
                key={frame.nonce}
                src={frame.src}
                title={m.visual_frame_title({ title })}
                sandbox={SANDBOX}
                referrerPolicy="no-referrer-when-downgrade"
                data-testid="visual-frame"
                ref={iframeRef}
                onLoad={() => {
                  frame.onLoad()
                  channel.onFrameLoad()
                }}
                className="block h-full w-full border-0 bg-background-surface"
              />
            ) : null}
          </div>
          {frame.loaded ? null : (
            <div
              role="status"
              className="absolute inset-0 flex items-center justify-center gap-2 bg-background-surface text-callout text-text-secondary"
              data-testid="visual-loading"
            >
              <SpinnerRing size={16} />
              <span>
                {frame.src
                  ? m.visual_loading()
                  : (unavailableReason ?? m.visual_loading())}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  // One root and one stage element in both modes, so the iframe keeps its
  // place in the tree (and its page state) when full screen toggles.
  return (
    <div
      data-testid="visual-preview"
      data-fullscreen={fullScreen ? 'true' : 'false'}
      className={cn(
        '@container/preview',
        fullScreen
          ? 'fixed inset-0 z-above-overlay bg-background-default'
          : 'relative flex h-full min-h-0 min-w-0 flex-col bg-background-default',
      )}
    >
      {fullScreen ? (
        <div className="absolute inset-x-0 top-3 z-10 flex justify-center px-3">
          <div className="surface-float flex h-11 max-w-full items-center gap-2 rounded-card px-2">
            {widthControl}
            {reloadButton}
            <span
              className="mx-1 h-5 w-px bg-border-default"
              aria-hidden="true"
            />
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => setFullScreen(false)}
              data-testid="visual-exit-fullscreen"
            >
              <CornersIn />
              {m.visual_exit_fullscreen()}
              <Kbd className="border-transparent bg-white/15 text-current shadow-none">
                {m.visual_esc()}
              </Kbd>
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border-default px-3">
          <StatusBadge tier={channel.tier} failed={channel.failed} />
          {channel.tier === 'on-save' ? <BlankHelp /> : null}
          <span className="flex-1" />
          {widthControl}
          {reloadButton}
          {previewUrl ? (
            <Hint label={m.visual_open_tab()} side="bottom">
              <Button asChild variant="quiet" size="icon-sm">
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={m.visual_open_tab()}
                  data-testid="visual-open-tab"
                >
                  <ArrowSquareOut />
                </a>
              </Button>
            </Hint>
          ) : null}
          <Hint
            side="bottom"
            label={
              <span className="inline-flex items-center gap-2">
                {m.visual_fullscreen()}
                <KbdCombo keys={[keys.mod, keys.shift, 'Enter']} />
              </span>
            }
          >
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="shrink-0 whitespace-nowrap"
              onClick={() => setFullScreen(true)}
              data-testid="visual-fullscreen"
            >
              <CornersOut />
              {m.visual_fullscreen()}
            </Button>
          </Hint>
        </div>
      )}
      {frameStage}
    </div>
  )
}

type StatusTone = 'neutral' | 'info' | 'success' | 'warning'

const STATUS_TONE: Record<StatusTone, { pill: string; dot: string }> = {
  neutral: {
    pill: 'bg-status-neutral-bg text-text-secondary',
    dot: 'bg-text-muted',
  },
  info: { pill: 'bg-status-info-bg text-text-accent', dot: 'bg-status-info' },
  success: {
    pill: 'bg-status-success-bg text-text-success',
    dot: 'bg-status-success',
  },
  warning: {
    pill: 'bg-status-warning-bg text-text-warning',
    dot: 'bg-status-warning',
  },
}

/** The label, tone and hint for each tier. A failed live request reads "Retrying". */
function statusView(tier: Tier, failed: boolean) {
  if (tier === 'live') {
    return failed
      ? {
          tone: 'warning' as const,
          label: m.visual_status_retrying(),
          hint: m.visual_status_retrying_hint(),
        }
      : {
          tone: 'success' as const,
          label: m.visual_status_live(),
          hint: m.visual_status_live_hint(),
        }
  }
  if (tier === 'connecting') {
    return {
      tone: 'neutral' as const,
      label: m.visual_status_connecting(),
      hint: null,
    }
  }
  return {
    tone: 'info' as const,
    label: m.visual_status_updates_on_save(),
    hint: m.visual_status_hint(),
  }
}

function StatusBadge({ tier, failed }: { tier: Tier; failed: boolean }) {
  const view = statusView(tier, failed)
  const tone = STATUS_TONE[view.tone]
  const pill = (
    <span
      data-testid="visual-status"
      data-tier={tier}
      data-error={failed ? 'true' : 'false'}
      className={cn(
        'inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full px-2 text-[12px] font-medium whitespace-nowrap',
        tone.pill,
      )}
    >
      <span
        aria-hidden="true"
        className={cn('size-1.5 rounded-full', tone.dot)}
      />
      {view.label}
    </span>
  )
  return view.hint ? (
    <Hint label={view.hint} side="bottom">
      {pill}
    </Hint>
  ) : (
    pill
  )
}

/** Explains the one thing that makes a preview blank: framing is blocked. */
function BlankHelp() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="quiet"
          size="sm"
          className="shrink-0 px-2 whitespace-nowrap text-text-muted underline underline-offset-4"
          data-testid="visual-blank-help"
        >
          {m.visual_blank_link()}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 text-callout text-text-secondary"
      >
        <p>{m.visual_blank_explanation()}</p>
      </PopoverContent>
    </Popover>
  )
}

/** A preview URL without its signed token: the same page part means the same document. */
function pagePart(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.searchParams.delete('token')
    return parsed.toString()
  } catch {
    return url
  }
}

/**
 * The frame URL and reloads. A refreshed signed token does not reload the frame.
 * A changed page (the slug changed) does. A save reloads it only when the bridge is
 * not live: a live page already shows the saved value and keeps its scroll.
 * Saves are debounced so a burst of autosaves reloads once.
 */
function useFrameReload({
  previewUrl,
  lastSavedAt,
  live,
}: {
  previewUrl: string | undefined
  lastSavedAt: Date | null
  live: boolean
}) {
  const [src, setSrc] = React.useState<string | undefined>(previewUrl)
  const [nonce, setNonce] = React.useState(0)
  const [loaded, setLoaded] = React.useState(false)
  const latest = React.useRef(previewUrl)
  // The URL the frame was last told to load.
  const shown = React.useRef(previewUrl)
  const liveRef = React.useRef(live)

  React.useEffect(() => {
    liveRef.current = live
  }, [live])

  const reload = React.useCallback(() => {
    shown.current = latest.current
    setSrc(latest.current)
    setNonce((value) => value + 1)
    setLoaded(false)
  }, [])

  React.useEffect(() => {
    latest.current = previewUrl
    if (!previewUrl) return
    // The first URL arrives after the entry loads.
    if (!shown.current) {
      shown.current = previewUrl
      setSrc(previewUrl)
      return
    }
    if (pagePart(shown.current) !== pagePart(previewUrl)) reload()
  }, [previewUrl, reload])

  const seen = React.useRef(lastSavedAt)
  React.useEffect(() => {
    if (seen.current === lastSavedAt) return
    seen.current = lastSavedAt
    if (!lastSavedAt) return
    const timer = window.setTimeout(() => {
      if (!liveRef.current) reload()
    }, RELOAD_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [lastSavedAt, reload])

  const onLoad = React.useCallback(() => setLoaded(true), [])

  return { src, nonce, loaded, onLoad, reload }
}

/** The stage's measured size, updated on resize. */
function useStageSize() {
  const ref = React.useRef<HTMLDivElement>(null)
  const [size, setSize] = React.useState({ width: 0, height: 0 })

  React.useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const update = () =>
      setSize({ width: node.clientWidth, height: node.clientHeight })
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return { ref, ...size }
}
