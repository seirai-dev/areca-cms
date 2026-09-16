import { Fragment, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { m } from '#/paraglide/messages'

const CODE_CLASS = 'rounded bg-muted px-1'

function inject(
  text: string,
  replacements: Record<string, (value: string) => ReactNode>,
): ReactNode {
  const tokens = Object.keys(replacements).sort((a, b) => b.length - a.length)
  if (tokens.length === 0) return text
  const pattern = new RegExp(
    `(${tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
    'g',
  )
  return text.split(pattern).map((part, index) => {
    const render = replacements[part]
    return render ? <Fragment key={index}>{render(part)}</Fragment> : part
  })
}

function code(value: string) {
  return <code className={CODE_CLASS}>{value}</code>
}

export function GetStarted() {
  const token = 'ARECA_SITE_TOKEN'
  const pkg = 'examples/demo-site'
  const envFile = '.env.local'
  const command = 'pnpm --filter @areca/demo-site sync-manifest'
  const publishAction = m.shell_get_started_publish_site()

  return (
    <Card data-testid="get-started">
      <CardHeader>
        <CardTitle>{m.shell_get_started_title()}</CardTitle>
        <CardDescription>{m.shell_get_started_description()}</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="grid list-decimal gap-4 pl-5 text-sm">
          <li>
            <Link
              to="/admin/organizations"
              className="font-medium underline underline-offset-4"
            >
              {m.shell_get_started_create_org()}
            </Link>
          </li>
          <li>
            {inject(m.shell_get_started_step_token({ token }), {
              [token]: code,
            })}
          </li>
          <li>
            {inject(m.shell_get_started_step_connect({ pkg, envFile }), {
              [pkg]: code,
              [envFile]: code,
            })}
            <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-xs leading-6">
              {m.shell_get_started_env_example()}
            </pre>
            {inject(m.shell_get_started_step_sync({ command }), {
              [command]: code,
            })}
          </li>
          <li>{m.shell_get_started_step_publish_content()}</li>
          <li>
            {inject(
              m.shell_get_started_step_publish_site({ action: publishAction }),
              {
                [publishAction]: (value) => (
                  <span className="font-medium">{value}</span>
                ),
              },
            )}
          </li>
        </ol>
      </CardContent>
    </Card>
  )
}
