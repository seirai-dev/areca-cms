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

import {
  GuideDisclosure,
  GuideOptional,
  GuideStep,
  GuideSteps,
  GuideUrl,
} from './guide-steps'
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
    <section className="grid gap-5" aria-labelledby="connect-ai-apps-title">
      <div className="grid gap-1">
        <h2
          id="connect-ai-apps-title"
          className="text-title-2 text-text-primary"
        >
          {m.connect_ai_apps_title()}
        </h2>
        <p className="text-callout text-text-secondary">
          {m.connect_ai_apps_hint()}
        </p>
      </div>

      <Tabs value={app} onValueChange={choose} className="gap-5">
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
          <TabsList className="w-full">
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

        <GuideCard value="chatgpt">
          <GuideSteps>
            <GuideStep number={1} text={m.connect_ai_chatgpt_1()} />
            <GuideStep number={2} text={m.connect_ai_chatgpt_2()} />
            <GuideStep
              number={3}
              text={m.connect_ai_chatgpt_3({ site: siteName })}
            >
              <GuideUrl url={input.url} />
            </GuideStep>
            <GuideStep number={4} text={m.connect_ai_chatgpt_4()} />
            <GuideStep number={5} text={m.connect_ai_chatgpt_5()} />
          </GuideSteps>
        </GuideCard>

        <GuideCard value="claude">
          <GuideSteps>
            <GuideStep number={1} text={m.connect_ai_claude_1()} />
            <GuideStep number={2} text={m.connect_ai_claude_2()} />
            <GuideStep
              number={3}
              text={m.connect_ai_claude_3({ site: siteName })}
            >
              <GuideUrl url={input.url} />
            </GuideStep>
            <GuideStep number={4} text={m.connect_ai_claude_4()} />
          </GuideSteps>
          <p className="border-t border-border-default pt-5 text-callout text-text-secondary">
            {m.connect_ai_claude_note()}
          </p>
        </GuideCard>

        <GuideCard value="claude-code">
          <GuideSteps>
            <GuideStep number={1} text={m.connect_ai_claude_code_1()}>
              <CodeBlock
                text={claudeCodeConnectCommand(input)}
                copyLabel={m.connect_ai_reveal_copy_command()}
                testId="connect-ai-command"
                wrap
              />
            </GuideStep>
            <GuideStep number={2} text={m.connect_ai_claude_code_2()} />
          </GuideSteps>
          <SkillsHint url={input.url} app="claude-code" />
        </GuideCard>

        <GuideCard value="cursor">
          <GuideSteps>
            <GuideStep number={1} text={m.connect_ai_cursor_1()}>
              <div>
                <Button asChild className="w-full sm:w-auto">
                  <a
                    href={cursorConnectLink(input)}
                    data-testid="connect-ai-add-cursor"
                  >
                    <ArrowSquareOut />
                    {m.connect_ai_reveal_add_cursor()}
                  </a>
                </Button>
              </div>
              <GuideDisclosure summary={m.connect_ai_cursor_fallback()}>
                <CodeBlock
                  text={connectorJsonConfig(input)}
                  copyLabel={m.connect_ai_reveal_copy_config()}
                  testId="connect-ai-cursor-config"
                />
              </GuideDisclosure>
            </GuideStep>
            <GuideStep number={2} text={m.connect_ai_cursor_2()} />
          </GuideSteps>
          <SkillsHint url={input.url} app="cursor" />
        </GuideCard>

        <GuideCard value="vscode">
          <GuideSteps>
            <GuideStep number={1} text={m.connect_ai_vscode_1()}>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button asChild className="w-full sm:w-auto">
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
                  className="w-full sm:w-auto"
                >
                  <a href={vscodeConnectLink(input, { insiders: true })}>
                    {m.connect_ai_reveal_add_vscode_insiders()}
                  </a>
                </Button>
              </div>
            </GuideStep>
            <GuideStep number={2} text={m.connect_ai_vscode_2()} />
          </GuideSteps>
          <SkillsHint url={input.url} app="vscode" />
        </GuideCard>

        <GuideCard value="other">
          <GuideSteps>
            <GuideStep text={m.connect_ai_other_body()}>
              <GuideUrl url={input.url} />
              <GuideDisclosure summary={m.connect_ai_other_note()}>
                <CodeBlock
                  text={connectorJsonConfig(input)}
                  copyLabel={m.connect_ai_reveal_copy_config()}
                  testId="connect-ai-generic-config"
                />
              </GuideDisclosure>
            </GuideStep>
          </GuideSteps>
          <SkillsHint url={input.url} app="other" />
        </GuideCard>
      </Tabs>
    </section>
  )
}

/**
 * "Or paste this into your AI": a prompt any app can follow to connect
 * itself. Its own section, because it is an alternative to the guides.
 */
export function ConnectPrompt({
  url,
  siteName,
}: {
  url: string
  siteName: string
}) {
  return (
    <section className="grid gap-5" aria-labelledby="connect-ai-prompt-title">
      <div className="grid gap-1">
        <h2
          id="connect-ai-prompt-title"
          className="text-title-2 text-text-primary"
        >
          {m.connect_ai_reveal_prompt_title()}
        </h2>
        <p className="text-callout text-text-secondary">
          {m.connect_ai_reveal_prompt_body()}
        </p>
      </div>
      <CodeBlock
        text={connectSetupPrompt({ siteName, url })}
        copyLabel={m.connect_ai_reveal_copy_prompt()}
        testId="connect-ai-prompt"
        wrap
      />
    </section>
  )
}

/** One app's guide, in a card under the tabs. */
function GuideCard({
  value,
  children,
}: {
  value: ConnectApp
  children: React.ReactNode
}) {
  return (
    <TabsContent
      value={value}
      className="grid grid-cols-[minmax(0,1fr)] gap-6 p-5 surface-card sm:p-6"
    >
      {children}
    </TabsContent>
  )
}

/**
 * For coding agents: one command installs the Areca skills (how to use the
 * SDK and these tools) and adds this connector in the agents the user picks.
 */
function SkillsHint({ url, app }: { url: string; app: ConnectApp }) {
  return (
    <GuideOptional
      title={m.connect_ai_skills_title()}
      description={m.connect_ai_skills_hint()}
    >
      <CodeBlock
        text={skillsInstallCommand(url)}
        copyLabel={m.connect_ai_reveal_copy_command()}
        testId={`connect-ai-skills-${app}`}
        wrap
      />
    </GuideOptional>
  )
}
