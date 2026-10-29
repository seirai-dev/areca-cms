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
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

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

/**
 * The live preview pane of Visual mode (Tier 0 and 1). The frame reloads
 * after each successful save and on the Reload button. The iframe element
 * never remounts when entering or leaving full screen: only the pane's
 * position classes change, so the page keeps its state.
 */
export function PreviewPane({
  previewUrl,
  title,
  lastSavedAt,
  unavailableReason,
}: {
  /** The signed preview URL, when the entry has one. */
  previewUrl: string | undefined
  /** The entry title, for the frame's accessible name. */
  title: string
  /** The last successful save. Each new value reloads the frame. */
  lastSavedAt: Date | null
  /** Why there is no preview yet (Tier 0), or null while it loads. */
  unavailableReason: string | null
}) {
  const { fullScreen, setFullScreen } = useVisualFullScreen()
  const prefs = useVisualPreferences()
  const width = prefs.width
  const keys = useModifierKeys()

  const frame = useFrameReload({ previewUrl, lastSavedAt })
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
                onLoad={frame.onLoad}
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
          <StatusBadge />
          <BlankHelp />
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

/** The status is always "Updates on save" until the live bridge exists. */
function StatusBadge() {
  return (
    <Hint label={m.visual_status_hint()} side="bottom">
      <span
        data-testid="visual-status"
        data-status="updates-on-save"
        className="inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full bg-status-info-bg px-2 text-[12px] font-medium whitespace-nowrap text-text-accent"
      >
        <span
          aria-hidden="true"
          className="size-1.5 rounded-full bg-status-info"
        />
        {m.visual_status_updates_on_save()}
      </span>
    </Hint>
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

/**
 * The frame URL and reloads. The frame keeps its loaded URL: a refreshed
 * signed token does not reload it, only a save or the Reload button does.
 * Saves are debounced so a burst of autosaves reloads once.
 */
function useFrameReload({
  previewUrl,
  lastSavedAt,
}: {
  previewUrl: string | undefined
  lastSavedAt: Date | null
}) {
  const [src, setSrc] = React.useState<string | undefined>(previewUrl)
  const [nonce, setNonce] = React.useState(0)
  const [loaded, setLoaded] = React.useState(false)
  const latest = React.useRef(previewUrl)

  React.useEffect(() => {
    latest.current = previewUrl
    // The first URL arrives after the entry loads.
    if (!src && previewUrl) setSrc(previewUrl)
  }, [previewUrl, src])

  const reload = React.useCallback(() => {
    setSrc(latest.current)
    setNonce((value) => value + 1)
    setLoaded(false)
  }, [])

  const seen = React.useRef(lastSavedAt)
  React.useEffect(() => {
    if (seen.current === lastSavedAt) return
    seen.current = lastSavedAt
    if (!lastSavedAt) return
    const timer = window.setTimeout(reload, RELOAD_DEBOUNCE_MS)
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
