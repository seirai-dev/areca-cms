import { createFileRoute } from '@tanstack/react-router'
import { siteContent } from '../content.ts'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <div className="p-8">
      <h1 className="text-4xl font-bold">Areca demo site</h1>
      <p className="mt-4 text-lg">
        Site key: <code>{siteContent.siteKey}</code>
      </p>
    </div>
  )
}
