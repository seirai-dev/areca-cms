import { ACTORS, POLICY_EXPECTATIONS } from '../authz-policies'
import type { Expected, Policy } from '../authz-policies'
import { matrixEntries } from './specs'

const OUTCOME: Record<Expected, string> = {
  allowed: 'allow',
  login: 'redirect /login',
  forbidden: '403',
  'not-found': '404',
  mfa: 'MFA_REQUIRED',
  reauth: 'REAUTH_REQUIRED',
}

const WHO: Record<Policy, string> = {
  public: 'anyone',
  user: 'any signed-in user',
  'org-editor': 'org editor, org owner, agency admin (MFA)',
  'org-owner': 'org owner, agency admin (MFA)',
  agency: 'agency admin (MFA)',
  'agency-fresh': 'agency admin (MFA) with fresh session (step-up)',
}

const tableRow = (cells: string[]) => `| ${cells.join(' | ')} |`

function policiesTable() {
  return [
    tableRow(['Policy', ...ACTORS]),
    tableRow(['---', ...ACTORS.map(() => '---')]),
    ...Object.entries(POLICY_EXPECTATIONS).map(([policy, expected]) =>
      tableRow([policy, ...ACTORS.map((actor) => OUTCOME[expected[actor]])]),
    ),
  ].join('\n')
}

function functionsTable() {
  return [
    tableRow(['Function', 'File', 'Policy', 'Who may call']),
    tableRow(['---', '---', '---', '---']),
    ...matrixEntries().map(({ name, module, spec }) =>
      tableRow([
        `\`${name}\``,
        `\`${module}.ts\``,
        `\`${spec.policy}\``,
        spec.doc ?? WHO[spec.policy],
      ]),
    ),
  ].join('\n')
}

function replaceBlock(doc: string, block: string, content: string) {
  const open = `<!-- generated:${block} -->`
  const close = `<!-- /generated:${block} -->`
  const start = doc.indexOf(open)
  const end = doc.indexOf(close)
  if (start === -1 || end < start) {
    throw new Error(`docs/AUTHZ_MATRIX.md has no ${open} ... ${close} block`)
  }
  return `${doc.slice(0, start + open.length)}\n${content}\n${doc.slice(end)}`
}

/** docs/AUTHZ_MATRIX.md with its policy and server-function tables regenerated from the matrix. */
export function renderAuthzMatrixDoc(current: string) {
  return replaceBlock(
    replaceBlock(current, 'policies', policiesTable()),
    'functions',
    functionsTable(),
  )
}
