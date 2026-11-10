import { Plus } from '@phosphor-icons/react'
import { m } from '@/paraglide/messages'
import { faq } from '@/lib/faq'
import { Container, WithCode } from '../ui'

export function Faq() {
  return (
    <section aria-labelledby="faq-title" className="py-24 sm:py-32">
      <Container className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_2fr]">
        <h2
          id="faq-title"
          className="text-[2.125rem] leading-[1.1] font-[620] tracking-[-0.035em] sm:text-title"
        >
          {m.faq_title()}
        </h2>
        <div className="divide-y divide-line border-y border-line">
          {faq.map(({ question: q, answer: a }) => (
            <details key={q()} className="group py-1">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 rounded-md py-4 text-body font-medium [&::-webkit-details-marker]:hidden">
                {q()}
                <Plus
                  size={18}
                  className="shrink-0 text-faint transition-transform duration-200 group-open:rotate-45"
                />
              </summary>
              <p className="max-w-[40rem] pb-5 text-small text-muted">
                <WithCode text={a()} terms={['areca pull']} />
              </p>
            </details>
          ))}
        </div>
      </Container>
    </section>
  )
}
