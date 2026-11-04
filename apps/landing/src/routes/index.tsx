import { createFileRoute } from '@tanstack/react-router'
import { m } from '@/paraglide/messages'
import { Nav } from '@/components/sections/nav'
import { Hero } from '@/components/sections/hero'
import { How } from '@/components/sections/how'
import { NeverCalls } from '@/components/sections/never-calls'
import { Features } from '@/components/sections/features'
import { Agency } from '@/components/sections/agency'
import { Ai } from '@/components/sections/ai'
import { Developers } from '@/components/sections/developers'
import { SelfHost } from '@/components/sections/self-host'
import { OpenSource } from '@/components/sections/open-source'
import { Faq } from '@/components/sections/faq'
import { Footer } from '@/components/sections/footer'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:bg-iris focus:px-4 focus:py-2 focus:text-white"
      >
        {m.skip_to_content()}
      </a>
      <Nav />
      <main id="main">
        <Hero />
        <How />
        <NeverCalls />
        <Features />
        <Agency />
        <Ai />
        <Developers />
        <SelfHost />
        <OpenSource />
        <Faq />
      </main>
      <Footer />
    </>
  )
}
