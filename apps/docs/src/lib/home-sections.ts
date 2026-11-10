// The sections of the docs, as shown on the home page. Also the source of the
// home page's ItemList structured data (src/lib/seo/pages/home.ts), so the
// cards and the schema can't drift.
import {
  BookOpen,
  Code,
  GraduationCap,
  type LucideIcon,
  Server,
  ShieldCheck,
} from 'lucide-react'

export type HomeSection = {
  title: string
  description: string
  href: string
  icon: LucideIcon
  /** Spans both columns of the grid. */
  wide?: boolean
}

export const sections: Array<HomeSection> = [
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
