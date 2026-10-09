import { llms, loader } from 'fumadocs-core/source'
import { defineDocs } from 'fumadocs-mdx/macro'
import { applyMdxPreset } from 'fumadocs-mdx/config'
import { rehypeCodeDefaultOptions } from 'fumadocs-core/mdx-plugins'
import { lucideIconsPlugin } from 'fumadocs-core/source/lucide-icons'
import { docsRoute } from './shared'

export const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    async: true,
    mdxOptions: applyMdxPreset({
      // Code blocks in a language Shiki doesn't know render as plain text
      // instead of failing the build.
      rehypeCodeOptions: {
        ...rehypeCodeDefaultOptions,
        fallbackLanguage: 'plaintext',
      },
    }),
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
})

export const source = loader({
  source: docs.toFumadocsSource(),
  baseUrl: docsRoute,
  plugins: [lucideIconsPlugin()],
})

export const docsLlms = llms(source, {
  renderPage: async (page) => `# ${page.data.title} (${page.url})

${await page.data.getText('processed')}`,
})
