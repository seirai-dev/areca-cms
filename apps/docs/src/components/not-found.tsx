import { Link } from '@tanstack/react-router'
import { HomeLayout } from 'fumadocs-ui/layouts/home'
import { baseOptions } from '@/lib/layout.shared'

export function NotFound() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="mx-auto flex max-w-xl flex-1 flex-col items-center justify-center gap-4 px-6 py-24 text-center">
        <p className="text-sm font-medium text-fd-primary">404</p>
        <h1 className="text-2xl font-semibold">Page not found</h1>
        <p className="text-fd-muted-foreground">
          This page may have moved. Try searching with{' '}
          <kbd className="rounded border px-1.5 py-0.5 text-xs">⌘ K</kbd>, or
          head back to the docs.
        </p>
        <Link
          to="/docs/$"
          params={{ _splat: '' }}
          className="rounded-lg bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground"
        >
          Back to the docs
        </Link>
      </main>
    </HomeLayout>
  )
}
