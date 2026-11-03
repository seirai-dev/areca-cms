import {
  Palette,
  ShieldCheck,
  UsersThree,
  GitBranch,
  User,
} from '@phosphor-icons/react'
import { m } from '@/paraglide/messages'
import { useActive, useTicker } from '@/lib/use-active'
import { Container, SectionHeader } from '../ui'

// Example tenants for the diagram. Names are illustrative data, not copy.
const CLIENTS = [
  {
    name: 'Northbound',
    sites: ['northbound.co', 'shop.nb.co'],
    people: ['owner', 'editor'],
  },
  {
    name: 'Studio Halden',
    sites: ['halden.studio'],
    people: ['owner', 'editor', 'editor'],
  },
  {
    name: 'Vela Clinics',
    sites: ['vela.health', 'vela.blog'],
    people: ['owner'],
  },
] as const
const SITES = CLIENTS.flatMap((c) => c.sites)

export function Agency() {
  const { ref, active, still } = useActive<HTMLDivElement>()
  const hop = useTicker(active, SITES.length, 1400)
  const points = [
    {
      icon: UsersThree,
      title: m.agency_point1_title(),
      body: m.agency_point1_body(),
    },
    {
      icon: Palette,
      title: m.agency_point2_title(),
      body: m.agency_point2_body(),
    },
    {
      icon: ShieldCheck,
      title: m.agency_point3_title(),
      body: m.agency_point3_body(),
    },
    {
      icon: GitBranch,
      title: m.agency_point4_title(),
      body: m.agency_point4_body(),
    },
  ]
  return (
    <section aria-labelledby="agency-title" className="py-24 sm:py-36">
      <Container className="grid grid-cols-1 items-center gap-14 lg:grid-cols-[1fr_1.05fr]">
        <div>
          <SectionHeader
            id="agency-title"
            title={m.agency_title()}
            lead={m.agency_lead()}
          />
          <dl className="mt-10 grid gap-x-8 gap-y-7 sm:grid-cols-2">
            {points.map(({ icon: Icon, title, body }) => (
              <div key={title}>
                <dt className="flex items-center gap-2.5 text-body font-semibold">
                  <Icon size={20} className="text-iris-ink" />
                  {title}
                </dt>
                <dd className="mt-1.5 text-small text-muted">{body}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div
          ref={ref}
          role="img"
          aria-label={m.agency_art_label()}
          className="rounded-[18px] border border-line bg-raised/60 p-5 sm:p-8"
        >
          <div className="flex justify-center">
            <span className="rounded-[14px] bg-iris px-6 py-3 text-body font-semibold text-white">
              {m.agency_art_agency()}
            </span>
          </div>
          {/* Connectors: a stem down, then a rail across the three clients. */}
          <div
            aria-hidden="true"
            className="mx-auto h-6 w-0.5 bg-line-strong"
          />
          <div
            aria-hidden="true"
            className="mx-[16.6%] hidden h-0.5 bg-line-strong sm:block"
          />
          <ul className="grid gap-3 sm:grid-cols-3 sm:gap-4">
            {CLIENTS.map((c) => (
              <li key={c.name} className="flex flex-col items-stretch">
                <span
                  aria-hidden="true"
                  className="mx-auto hidden h-5 w-0.5 bg-line-strong sm:block"
                />
                <div className="flex flex-1 flex-col rounded-[14px] border border-line-strong bg-bg p-4">
                  <p className="text-body font-semibold">{c.name}</p>
                  <ul className="mt-3 grid gap-2">
                    {c.sites.map((site) => {
                      const on = !still && SITES[hop] === site
                      return (
                        <li
                          key={site}
                          className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 font-mono text-[0.8125rem] transition-colors duration-300 ${
                            on
                              ? 'border-iris-ink bg-iris-soft text-fg'
                              : 'border-line text-muted'
                          }`}
                        >
                          <span className="size-2 shrink-0 rounded-full bg-live" />
                          <span className="truncate">{site}</span>
                        </li>
                      )
                    })}
                  </ul>
                  <div className="mt-auto flex items-center gap-2 pt-4">
                    <span className="flex -space-x-1.5">
                      {c.people.map((role, i) => (
                        <span
                          key={i}
                          className={`grid size-7 place-items-center rounded-full border-2 bg-raised text-faint ${
                            role === 'owner'
                              ? 'border-iris-ink'
                              : 'border-line-strong'
                          }`}
                        >
                          <User size={14} weight="fill" />
                        </span>
                      ))}
                    </span>
                    <span className="text-micro text-muted">
                      {c.people.length > 1
                        ? m.agency_art_team()
                        : m.agency_art_owner()}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </Container>
    </section>
  )
}
