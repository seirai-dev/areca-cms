import { HardDrives, ShieldSlash, Database } from '@phosphor-icons/react'
import { m } from '@/paraglide/messages'
import { CodeBlock } from '../code-block'
import { Container, SectionHeader, WithCode } from '../ui'

export function SelfHost() {
  return (
    <section
      id="self-host"
      aria-labelledby="host-title"
      className="scroll-mt-20 border-t border-line py-24 sm:py-36"
    >
      <Container className="grid grid-cols-1 items-start gap-14 lg:grid-cols-2">
        <div>
          <SectionHeader
            id="host-title"
            title={m.host_title()}
            lead={<WithCode text={m.host_lead()} terms={['/setup']} />}
          />
          <ul className="mt-9 space-y-4">
            {[
              { icon: HardDrives, text: m.host_point1() },
              { icon: ShieldSlash, text: m.host_point2() },
              { icon: Database, text: m.host_point3() },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex gap-3 text-body text-muted">
                <Icon size={20} className="mt-0.5 shrink-0 text-iris-ink" />
                {text}
              </li>
            ))}
          </ul>
        </div>
        <CodeBlock
          className="lg:mt-3"
          title={m.host_code_label()}
          prompt
          lines={[
            [
              { t: 'git clone ', c: 'f' },
              { t: 'https://github.com/seirai-dev/areca-cms' },
            ],
            [{ t: 'cd ', c: 'f' }, { t: 'areca-cms/docker' }],
            [
              { t: 'cp ', c: 'f' },
              { t: '.env.example .env  ' },
              { t: '# then set your secrets', c: 'c' },
            ],
            [{ t: 'docker compose ', c: 'f' }, { t: 'up -d --wait' }],
          ]}
        />
      </Container>
    </section>
  )
}
