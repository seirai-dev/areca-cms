import { m } from '@/paraglide/messages'
import { links } from '@/lib/links'
import { Logo } from '../logo'
import { Container } from '../ui'

export function Footer() {
  return (
    <footer className="border-t border-line py-14">
      <Container className="grid gap-10 sm:grid-cols-[1fr_auto]">
        <div>
          <Logo />
          <p className="mt-3 text-small text-muted">{m.footer_tagline()}</p>
          <p className="mt-8 max-w-[30rem] text-micro text-faint">
            {m.footer_requests()}
          </p>
        </div>
        <ul className="grid content-start gap-2.5 text-small">
          <li>
            <a className="text-muted hover:text-fg" href={links.docs}>
              {m.footer_docs()}
            </a>
          </li>
          <li>
            <a
              className="text-muted hover:text-fg"
              href={links.github}
              target="_blank"
              rel="noreferrer"
            >
              {m.footer_github()}
            </a>
          </li>
          <li>
            <a
              className="text-muted hover:text-fg"
              href={links.demo}
              target="_blank"
              rel="noreferrer"
            >
              {m.footer_demo()}
            </a>
          </li>
          <li className="text-faint">{m.footer_license()}</li>
        </ul>
      </Container>
    </footer>
  )
}
