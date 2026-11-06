import { createFileRoute, Link } from '@tanstack/react-router'
import { HomeLayout } from 'fumadocs-ui/layouts/home'
import {
  BookOpen,
  Code,
  GraduationCap,
  type LucideIcon,
  Server,
  ShieldCheck,
} from 'lucide-react'
import { baseOptions } from '@/lib/layout.shared'

export const Route = createFileRoute('/')({
  component: Home,
})

const sections: Array<{
  title: string
  description: string
  href: string
  icon: LucideIcon
  /** Spans both columns of the grid. */
  wide?: boolean
}> = [
  {
    title: 'Guides',
    description:
      'Step-by-step: connect your first website to Areca, from empty folder to live site.',
    href: '/docs/guides',
    icon: GraduationCap,
    wide: true,
  },
  {
    title: 'Use the CMS',
    description:
      'Write and review content, preview it, and go live. Covers both editors and agency admins.',
    href: '/docs/cms',
    icon: BookOpen,
  },
  {
    title: 'Build with the SDK',
    description:
      'Connect a website to Areca: define content, pull snapshots, render rich text, preview drafts.',
    href: '/docs/sdk',
    icon: Code,
  },
  {
    title: 'Self-host Areca',
    description:
      'Install with Docker, configure, deploy customer sites, operate, upgrade and recover.',
    href: '/docs/self-hosting',
    icon: Server,
  },
  {
    title: 'Security',
    description:
      'Roles and permissions, two-factor authentication, tokens, secrets and rate limits.',
    href: '/docs/security',
    icon: ShieldCheck,
  },
]

function Home() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-16 md:py-24">
        <p className="mb-3 text-sm font-medium text-fd-primary">
          Areca CMS documentation
        </p>
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight md:text-5xl">
          The CMS for agency-managed websites.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-fd-muted-foreground">
          Write content in the CMS, approve it, then go live. Every release is
          an immutable snapshot that your website pulls at build time through
          the site SDK.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to="/docs/$"
            params={{ _splat: '' }}
            className="rounded-lg bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground transition-opacity hover:opacity-90"
          >
            Get started
          </Link>
          <Link
            to="/docs/$"
            params={{ _splat: 'sdk' }}
            className="rounded-lg border px-4 py-2 text-sm font-medium transition-colors hover:bg-fd-accent"
          >
            SDK reference
          </Link>
        </div>

        <div className="mt-16 grid gap-px overflow-hidden rounded-xl border bg-fd-border sm:grid-cols-2">
          {sections.map((section) => (
            <a
              key={section.href}
              href={section.href}
              className={`group flex flex-col gap-2 bg-fd-background p-6 transition-colors hover:bg-fd-card${section.wide ? ' sm:col-span-2' : ''}`}
            >
              <section.icon className="size-5 text-fd-primary" />
              <span className="font-medium">{section.title}</span>
              <span className="text-sm text-fd-muted-foreground">
                {section.description}
              </span>
            </a>
          ))}
        </div>
      </main>
    </HomeLayout>
  )
}
