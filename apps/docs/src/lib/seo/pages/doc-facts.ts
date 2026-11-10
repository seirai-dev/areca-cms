// Build-time SEO facts for a docs page: breadcrumbs, section, last-modified
// date, step series and FAQ. Server only: the docs route imports this module
// dynamically inside its server function handler, so node:child_process never
// reaches the client bundle.
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import type { Folder, Item, Node } from 'fumadocs-core/page-tree'
import { source } from '@/lib/source'
import type { DocSeoFacts } from './doc'

type Page = NonNullable<ReturnType<typeof source.getPage>>

const DOCS_HOME = { name: 'Docs', path: '/docs' }
const CONTENT_DIR = 'content/docs'
/** Sections written for newcomers. Matched by the root folder's directory. */
const BEGINNER_DIRS = new Set(['(start)', 'guides'])
const STEP_TITLE = /^Step\s+\d+\s*[:.–-]\s*/

export async function docSeoFacts(page: Page): Promise<DocSeoFacts> {
  const facts: DocSeoFacts = { crumbs: [] }
  const folder = rootFolderOf(source.getPageTree().children, page.url)

  const section = folder ? text(folder.name) : undefined
  facts.section = section
  // The docs home gets no trail: it is the first crumb of every other page.
  if (folder && section && page.url !== DOCS_HOME.path) {
    const sectionPath = folder.index?.url ?? DOCS_HOME.path
    // A section index shares its URL with the section crumb. It keeps a
    // third crumb anyway, so llms.txt can file it under its section.
    const name =
      page.url === folder.index?.url && page.data.title === section
        ? 'Overview'
        : page.data.title
    facts.crumbs = [
      DOCS_HOME,
      { name: section, path: sectionPath },
      { name, path: page.url },
    ]
  }

  const topDir = page.path.split('/')[0]
  if (BEGINNER_DIRS.has(topDir)) facts.proficiencyLevel = 'Beginner'

  if (folder && folder.index?.url === page.url) {
    const steps = stepsOf(folder)
    if (steps.length >= 2) facts.steps = steps
  }

  facts.modified = await lastModified(
    page.absolutePath ?? path.resolve(CONTENT_DIR, page.path),
  )
  facts.faq = await faqOf(page)
  return facts
}

// ------------------------------------------------------------ page tree --

function text(name: unknown): string {
  return typeof name === 'string' ? name : String(name ?? '')
}

/** The top-level folder (a meta.json `root` section) that holds `url`. */
function rootFolderOf(nodes: Array<Node>, url: string): Folder | undefined {
  return nodes.find(
    (node): node is Folder => node.type === 'folder' && contains(node, url),
  )
}

function contains(folder: Folder, url: string): boolean {
  if (folder.index?.url === url) return true
  return folder.children.some((child) =>
    child.type === 'folder' ? contains(child, url) : child.type === 'page' && child.url === url,
  )
}

/** Pages titled "Step N: …" in the folder's meta.json order. */
function stepsOf(folder: Folder): NonNullable<DocSeoFacts['steps']> {
  return folder.children
    .filter((child): child is Item => child.type === 'page')
    .filter((item) => STEP_TITLE.test(text(item.name)))
    .map((item) => {
      const description = item.description
      return {
        name: text(item.name).replace(STEP_TITLE, ''),
        path: item.url,
        text: typeof description === 'string' ? description : undefined,
      }
    })
}

// --------------------------------------------------------- last modified --

let gitDates: Promise<Map<string, string> | undefined> | undefined

/**
 * Last commit date of a content file. Undefined without git, for uncommitted
 * files, and in shallow clones (CI, Docker), where every file would get the
 * date of the one commit that was fetched.
 */
async function lastModified(file: string): Promise<string | undefined> {
  gitDates ??= readGitDates(path.resolve(CONTENT_DIR))
  return (await gitDates)?.get(path.resolve(file))
}

async function readGitDates(dir: string) {
  const git = (args: Array<string>) =>
    execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    }).trim()
  try {
    if (git(['rev-parse', '--is-shallow-repository']) !== 'false') return
    const root = git(['rev-parse', '--show-toplevel'])
    // One log for the whole directory, newest first: the first date seen for
    // a file is its last change.
    const log = git(['-c', 'core.quotepath=off', 'log', '--format=commit:%cI', '--name-only', '--', '.'])
    const dates = new Map<string, string>()
    let date: string | undefined
    for (const line of log.split('\n')) {
      if (line.startsWith('commit:')) date = line.slice(7)
      else if (line && date) {
        const file = path.resolve(root, line)
        if (!dates.has(file)) dates.set(file, date)
      }
    }
    return dates
  } catch {
    return undefined
  }
}

// -------------------------------------------------------------------- faq --

const ACCORDION =
  /<Accordion\s+title=(?:"([^"]*)"|'([^']*)')\s*>([\s\S]*?)<\/Accordion>/g

/**
 * Troubleshooting pages list each problem as an <Accordion> with its answer
 * inside. Any page with accordions becomes a FAQPage; if one accordion does not
 * parse cleanly, the page gets none rather than a partial list.
 */
async function faqOf(page: Page): Promise<DocSeoFacts['faq']> {
  let markdown: string
  try {
    markdown = await page.data.getText('processed')
  } catch {
    return undefined
  }
  const opened = markdown.match(/<Accordion\b/g)?.length ?? 0
  if (opened === 0) return undefined

  const faq: NonNullable<DocSeoFacts['faq']> = []
  for (const match of markdown.matchAll(ACCORDION)) {
    const question = plain(match[1] ?? match[2] ?? '')
    const answer = plain(match[3])
    if (!question || !answer || /<Accordion\b/.test(match[3])) return undefined
    faq.push({ question, answer })
  }
  return faq.length === opened ? faq : undefined
}

/** Markdown to one line of plain text. */
function plain(markdown: string): string {
  return markdown
    .replace(/```[^\n]*\n([\s\S]*?)```/g, '$1')
    .replace(/<\/?[A-Z][\w.]*(?:\s[^>]*)?>/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}
