import * as React from 'react'
import { ArrowSquareOut } from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'
import {
  claudeCodeConnectCommand,
  connectSetupPrompt,
  connectorJsonConfig,
  cursorConnectLink,
  skillsInstallCommand,
  vscodeConnectLink,
} from '#/lib/mcp-install'
import type { McpConnectInput } from '#/lib/mcp-install'
import { m } from '#/paraglide/messages'

import { CodeBlock } from './key-reveal'

/** The AI apps with a guide on Connect AI, in the order people use them. */
export const CONNECT_APPS = [
  'chatgpt',
  'claude',
  'claude-code',
  'cursor',
  'vscode',
  'other',
] as const
export type ConnectApp = (typeof CONNECT_APPS)[number]

function connectAppLabel(app: ConnectApp): string {
  switch (app) {
    case 'chatgpt':
      return m.connect_ai_app_chatgpt()
    case 'claude':
      return m.connect_ai_app_claude()
    case 'claude-code':
      return m.connect_ai_app_claude_code()
    case 'cursor':
      return m.connect_ai_app_cursor()
    case 'vscode':
      return m.connect_ai_app_vscode()
    case 'other':
      return m.connect_ai_app_other()
  }
}

/**
 * "Connect your AI app": one guide per app, in plain steps. Desktop shows
 * tabs; phones get a menu, because six labels do not fit a row.
 */
export function ConnectApps({
  input,
  siteName,
}: {
  input: McpConnectInput
  siteName: string
}) {
  const [app, setApp] = React.useState<ConnectApp>('chatgpt')
  const choose = (value: string) => setApp(value as ConnectApp)

  return (
    <section className="grid gap-4" aria-labelledby="connect-ai-apps-title">
      <div className="grid gap-0.5 px-1">
        <h2
          id="connect-ai-apps-title"
          className="text-headline text-text-primary"
        >
          {m.connect_ai_apps_title()}
        </h2>
        <p className="text-callout text-text-secondary">
          {m.connect_ai_apps_hint()}
        </p>
      </div>

      <Tabs value={app} onValueChange={choose} className="gap-4">
        <div className="md:hidden">
          <Select value={app} onValueChange={choose}>
            <SelectTrigger
              className="w-full min-h-11"
              aria-label={m.connect_ai_field_app()}
              data-testid="connect-ai-guide-picker"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONNECT_APPS.map((item) => (
                <SelectItem key={item} value={item}>
                  {connectAppLabel(item)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="hidden md:block">
          <TabsList className="flex-wrap">
            {CONNECT_APPS.map((item) => (
              <TabsTrigger
                key={item}
                value={item}
                data-testid={`connect-ai-guide-tab-${item}`}
              >
                {connectAppLabel(item)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="chatgpt">
          <Steps
            steps={[
              m.connect_ai_chatgpt_1(),
              m.connect_ai_chatgpt_2(),
              m.connect_ai_chatgpt_3({ site: siteName }),
              m.connect_ai_chatgpt_4(),
              m.connect_ai_chatgpt_5(),
            ]}
          />
        </TabsContent>

        <TabsContent value="claude">
          <Steps
            steps={[
              m.connect_ai_claude_1(),
              m.connect_ai_claude_2(),
              m.connect_ai_claude_3({ site: siteName }),
              m.connect_ai_claude_4(),
            ]}
          />
          <p className="text-callout text-text-secondary">
            {m.connect_ai_claude_note()}
          </p>
        </TabsContent>

        <TabsContent value="claude-code">
          <Steps
            steps={[m.connect_ai_claude_code_1(), m.connect_ai_claude_code_2()]}
          />
          <CodeBlock
            text={claudeCodeConnectCommand(input)}
            copyLabel={m.connect_ai_reveal_copy_command()}
            testId="connect-ai-command"
            wrap
          />
          <SkillsHint url={input.url} app="claude-code" />
        </TabsContent>

        <TabsContent value="cursor">
          <Steps steps={[m.connect_ai_cursor_1(), m.connect_ai_cursor_2()]} />
          <div>
            <Button asChild size="lg" className="min-h-11 w-full sm:w-auto">
              <a
                href={cursorConnectLink(input)}
                data-testid="connect-ai-add-cursor"
              >
                <ArrowSquareOut />
                {m.connect_ai_reveal_add_cursor()}
              </a>
            </Button>
          </div>
          <details className="group/fallback grid gap-3">
            <summary className="min-h-11 cursor-pointer list-none text-callout text-text-secondary underline-offset-4 hover:underline [&::-webkit-details-marker]:hidden">
              {m.connect_ai_cursor_fallback()}
            </summary>
            <CodeBlock
              text={connectorJsonConfig(input)}
              copyLabel={m.connect_ai_reveal_copy_config()}
              testId="connect-ai-cursor-config"
            />
          </details>
          <SkillsHint url={input.url} app="cursor" />
        </TabsContent>

        <TabsContent value="vscode">
          <Steps steps={[m.connect_ai_vscode_1(), m.connect_ai_vscode_2()]} />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button asChild size="lg" className="min-h-11 w-full sm:w-auto">
              <a
                href={vscodeConnectLink(input)}
                data-testid="connect-ai-add-vscode"
              >
                <ArrowSquareOut />
                {m.connect_ai_reveal_add_vscode()}
              </a>
            </Button>
            <Button
              asChild
              variant="secondary"
              size="lg"
              className="min-h-11 w-full sm:w-auto"
            >
              <a href={vscodeConnectLink(input, { insiders: true })}>
                {m.connect_ai_reveal_add_vscode_insiders()}
              </a>
            </Button>
          </div>
          <SkillsHint url={input.url} app="vscode" />
        </TabsContent>

        <TabsContent value="other">
          <p className="text-callout text-text-secondary">
            {m.connect_ai_other_body()}
          </p>
          <details className="group/fallback grid gap-3">
            <summary className="min-h-11 cursor-pointer list-none text-callout text-text-secondary underline-offset-4 hover:underline [&::-webkit-details-marker]:hidden">
              {m.connect_ai_other_note()}
            </summary>
            <CodeBlock
              text={connectorJsonConfig(input)}
              copyLabel={m.connect_ai_reveal_copy_config()}
              testId="connect-ai-generic-config"
            />
          </details>
          <SkillsHint url={input.url} app="other" />
        </TabsContent>
      </Tabs>

      <div className="grid gap-2 border-t border-border-default pt-5">
        <div className="grid gap-0.5">
          <h3 className="text-headline text-text-primary">
            {m.connect_ai_reveal_prompt_title()}
          </h3>
          <p className="text-callout text-text-secondary">
            {m.connect_ai_reveal_prompt_body()}
          </p>
        </div>
        <CodeBlock
          text={connectSetupPrompt({ siteName, url: input.url })}
          copyLabel={m.connect_ai_reveal_copy_prompt()}
          testId="connect-ai-prompt"
          wrap
        />
      </div>
    </section>
  )
}

/**
 * For coding agents: one command installs the Areca skills (how to use the
 * SDK and these tools) and adds this connector in the agents the user picks.
 */
function SkillsHint({ url, app }: { url: string; app: ConnectApp }) {
  return (
    <div className="grid gap-2 border-t border-border-default pt-4">
      <p className="text-callout text-text-secondary">
        {m.connect_ai_skills_hint()}
      </p>
      <CodeBlock
        text={skillsInstallCommand(url)}
        copyLabel={m.connect_ai_reveal_copy_command()}
        testId={`connect-ai-skills-${app}`}
        wrap
      />
    </div>
  )
}

/** Numbered plain-language steps for one app. */
function Steps({ steps }: { steps: string[] }) {
  return (
    <ol className="grid gap-2.5 ps-5 text-callout text-text-primary marker:font-semibold marker:text-text-secondary list-decimal">
      {steps.map((step) => (
        <li key={step} className="ps-1">
          {step}
        </li>
      ))}
    </ol>
  )
}
