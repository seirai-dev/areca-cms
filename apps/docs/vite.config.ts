import { globSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { fumadocsMdx } from 'fumadocs-mdx/vite'
import { getSlugs } from 'fumadocs-core/source'
import { getPageMarkdownUrl } from './src/lib/shared'

// HTML pages are found by crawling links, but nothing links to the raw
// markdown variants (used by "Copy Markdown" and LLM tools), so list them.
const markdownPages = globSync('**/*.{md,mdx}', { cwd: 'content/docs' }).map(
  (file) => ({ path: getPageMarkdownUrl({ slugs: getSlugs(file) }).url }),
)

export default defineConfig({
  plugins: [
    fumadocsMdx(),
    tailwindcss(),
    tanstackStart({
      prerender: {
        enabled: true,
        crawlLinks: true,
        failOnError: true,
      },
      pages: [
        { path: '/' },
        { path: '/docs' },
        { path: '/404' },
        { path: '/api/search' },
        { path: '/llms.txt' },
        { path: '/llms-full.txt' },
        ...markdownPages,
      ],
    }),
    react(),
  ],
  resolve: {
    tsconfigPaths: true,
    alias: {
      tslib: 'tslib/tslib.es6.js',
    },
  },
})
