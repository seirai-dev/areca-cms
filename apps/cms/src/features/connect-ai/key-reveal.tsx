import * as React from 'react'
import { ArrowSquareOut, Warning } from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'
import { DialogTitle } from '#/components/ui/dialog'
import { CopyButton } from '#/components/ui/copy-button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'
import {
  claudeCodeCommand,
  claudeDesktopConfig,
  cursorInstallLink,
  genericMcpConfig,
  setupPrompt,
  vscodeInstallLink,
} from '#/lib/mcp-install'
import type { McpInstallInput } from '#/lib/mcp-install'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

import { GuideStep, GuideSteps } from './guide-steps'

/** The AI apps the install guide knows about. */
export const AI_APPS = [
  'claude-code',
  'cursor',
  'vscode',
  'claude-desktop',
  'other',
] as const
export type AiApp = (typeof AI_APPS)[number]

export function appLabel(app: AiApp): string {
  switch (app) {
    case 'claude-code':
      return m.connect_ai_app_claude_code()
    case 'cursor':
      return m.connect_ai_app_cursor()
    case 'vscode':
      return m.connect_ai_app_vscode()
    case 'claude-desktop':
      return m.connect_ai_app_claude_desktop()
    case 'other':
      return m.connect_ai_app_other()
  }
}

/**
 * The one-time reveal after a key is created. The key only exists in this
 * component's props; closing the dialog drops it for good. Every install
 * option embeds the real key, so the user never has to type it.
 */
export function KeyReveal({
  install,
  siteName,
  initialApp,
  onDone,
}: {
  install: McpInstallInput
  siteName: string
  initialApp: AiApp
  onDone: () => void
}) {
  const [app, setApp] = React.useState<AiApp>(initialApp)
  const prompt = setupPrompt({
    siteName,
    url: install.url,
    key: install.key,
  })

  return (
    <div className="grid gap-5" data-testid="connect-ai-reveal">
      <div className="grid gap-1.5 pr-8">
        <DialogTitle className="text-title-2 text-text-primary">
          {m.connect_ai_reveal_title()}
        </DialogTitle>
      </div>

      <div
        role="alert"
        data-testid="connect-ai-warning"
        className="flex gap-3 rounded-card border border-border-default bg-status-warning-bg p-4"
      >
        <Warning
          weight="duotone"
          className="mt-0.5 size-5 shrink-0 text-icon-warning"
          aria-hidden="true"
        />
        <div className="grid min-w-0 gap-1">
          <p className="text-[14px] leading-5 font-semibold text-text-primary">
            {m.connect_ai_reveal_warning_title()}
          </p>
          <p className="text-callout text-text-secondary">
            {m.connect_ai_reveal_warning()}
          </p>
        </div>
      </div>

      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-caption text-text-muted">
            {m.connect_ai_reveal_key_label()}
          </span>
          <CopyButton
            value={install.key}
            label={m.connect_ai_reveal_copy_key()}
            variant="secondary"
            size="sm"
            toastMessage={m.connect_ai_copied_toast()}
            data-testid="connect-ai-copy-key"
          />
        </div>
        <p
          className="scroll-quiet overflow-x-auto rounded-control bg-background-subtle px-3 py-2.5 font-mono text-[13px] leading-5 break-all text-text-primary select-all"
          data-testid="connect-ai-key"
        >
          {install.key}
        </p>
      </div>

      <Tabs
        value={app}
        onValueChange={(value) => setApp(value as AiApp)}
        className="gap-5"
      >
        {/* Narrow screens: a picker, because five labels do not fit in a row. */}
        <div className="md:hidden">
          <Select value={app} onValueChange={(value) => setApp(value as AiApp)}>
            <SelectTrigger
              className="w-full min-h-11"
              aria-label={m.connect_ai_field_app()}
              data-testid="connect-ai-app-picker"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AI_APPS.map((item) => (
                <SelectItem key={item} value={item}>
                  {appLabel(item)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="hidden md:block">
          <TabsList>
            {AI_APPS.map((item) => (
              <TabsTrigger
                key={item}
                value={item}
                data-testid={`connect-ai-tab-${item}`}
              >
                {appLabel(item)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="claude-code">
          <GuideSteps>
            <GuideStep text={m.connect_ai_reveal_step_claude_code()}>
              <CodeBlock
                text={claudeCodeCommand(install)}
                copyLabel={m.connect_ai_reveal_copy_command()}
                testId="connect-ai-command"
                wrap
              />
            </GuideStep>
          </GuideSteps>
        </TabsContent>

        <TabsContent value="cursor">
          <GuideSteps>
            <GuideStep text={m.connect_ai_reveal_step_cursor()}>
              <div className="flex flex-wrap gap-2">
                <Button asChild className="w-full sm:w-auto">
                  <a
                    href={cursorInstallLink(install)}
                    data-testid="connect-ai-add-cursor"
                  >
                    <ArrowSquareOut />
                    {m.connect_ai_reveal_add_cursor()}
                  </a>
                </Button>
                <CopyButton
                  value={genericMcpConfig(install)}
                  label={m.connect_ai_reveal_copy_config()}
                  variant="secondary"
                />
              </div>
            </GuideStep>
          </GuideSteps>
        </TabsContent>

        <TabsContent value="vscode">
          <GuideSteps>
            <GuideStep text={m.connect_ai_reveal_step_vscode()}>
              <div className="flex flex-wrap gap-2">
                <Button asChild className="w-full sm:w-auto">
                  <a
                    href={vscodeInstallLink(install)}
                    data-testid="connect-ai-add-vscode"
                  >
                    <ArrowSquareOut />
                    {m.connect_ai_reveal_add_vscode()}
                  </a>
                </Button>
                <Button
                  asChild
                  variant="secondary"
                  className="w-full sm:w-auto"
                >
                  <a href={vscodeInstallLink(install, { insiders: true })}>
                    {m.connect_ai_reveal_add_vscode_insiders()}
                  </a>
                </Button>
              </div>
            </GuideStep>
          </GuideSteps>
        </TabsContent>

        <TabsContent value="claude-desktop">
          <GuideSteps>
            <GuideStep text={m.connect_ai_reveal_step_desktop()}>
              <CodeBlock
                text={claudeDesktopConfig(install)}
                copyLabel={m.connect_ai_reveal_copy_config()}
                testId="connect-ai-desktop-config"
              />
            </GuideStep>
          </GuideSteps>
        </TabsContent>

        <TabsContent value="other">
          <GuideSteps>
            <GuideStep text={m.connect_ai_reveal_step_other()}>
              <CodeBlock
                text={genericMcpConfig(install)}
                copyLabel={m.connect_ai_reveal_copy_config()}
                testId="connect-ai-generic-config"
              />
            </GuideStep>
          </GuideSteps>
        </TabsContent>
      </Tabs>

      <div className="grid gap-3 border-t border-border-default pt-5">
        <div className="grid gap-1">
          <h3 className="text-headline text-text-primary">
            {m.connect_ai_reveal_prompt_title()}
          </h3>
          <p className="text-callout text-text-secondary">
            {m.connect_ai_reveal_prompt_body()}
          </p>
        </div>
        <CodeBlock
          text={prompt}
          copyLabel={m.connect_ai_reveal_copy_prompt()}
          testId="connect-ai-prompt"
          wrap
        />
      </div>

      <Button
        type="button"
        size="lg"
        className="min-h-11 w-full"
        onClick={onDone}
        data-testid="connect-ai-done"
      >
        {m.connect_ai_reveal_done()}
      </Button>
    </div>
  )
}

/**
 * Monospace block with its copy button. Wrapped text (commands, prompts)
 * keeps the button beside it on wide screens, so a one-line command reads as
 * one row; configs and phones put it in a header row so the text keeps the
 * full width.
 */
export function CodeBlock({
  text,
  copyLabel,
  testId,
  wrap = false,
}: {
  text: string
  copyLabel: string
  testId: string
  /** Wrap long lines (commands, prompts) instead of scrolling sideways. */
  wrap?: boolean
}) {
  return (
    <div
      className={cn(
        'grid min-w-0 overflow-hidden rounded-card border border-border-default bg-background-subtle',
        wrap && 'sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start',
      )}
    >
      <div
        className={cn(
          'flex justify-end border-b border-border-default px-2 py-1.5',
          wrap && 'sm:order-last sm:border-b-0 sm:py-2 sm:ps-0',
        )}
      >
        <CopyButton
          value={text}
          label={copyLabel}
          variant="quiet"
          size="sm"
          toastMessage={m.connect_ai_copied_toast()}
          data-testid={`${testId}-copy`}
        />
      </div>
      <pre
        data-testid={testId}
        className={cn(
          'scroll-quiet max-h-64 min-w-0 overflow-auto px-4 py-3.5 font-mono text-[12.5px] leading-5 text-text-primary',
          wrap ? 'break-words whitespace-pre-wrap' : 'whitespace-pre',
        )}
      >
        {text}
      </pre>
    </div>
  )
}
