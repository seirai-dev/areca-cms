import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'
import { appName, gitConfig } from './shared'

function Logo() {
  return (
    <span className="inline-flex items-center gap-2 font-semibold tracking-tight">
      <img src="/favicon.svg" alt="" width={22} height={22} />
      {appName}
    </span>
  )
}

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <Logo />,
      url: '/',
    },
    githubUrl: gitConfig.editLinks
      ? `https://github.com/${gitConfig.user}/${gitConfig.repo}`
      : undefined,
  }
}
