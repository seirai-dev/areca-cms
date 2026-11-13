import { describe, expect, it, vi } from 'vitest'

import { codeHighlighter } from '#/lib/highlight'

import {
  grammarHighlighter,
  loadCodeGrammar,
  onCodeGrammarLoaded,
} from './code-grammars'
import { codeTokenRanges } from './code-highlight'

const samples: Record<string, string> = {
  go: 'func main() { fmt.Println("hi") }',
  html: '<style>a { color: red }</style><script>const x = 1</script><p class="a">Hi</p>',
  php: '<?php echo "hi"; ?><div><script>let y = 2</script></div>',
  markdown:
    '# Title\n\n```ts\nconst z: number = 3\n```\n\n```bash\necho hi\n```\n',
}

describe('code grammars', () => {
  it('loads a grammar on demand and tells listeners', async () => {
    expect(grammarHighlighter('go')).toBeNull()
    expect(codeTokenRanges(samples.go, 'go')).toEqual([])
    const listener = vi.fn()
    const off = onCodeGrammarLoaded(listener)
    await loadCodeGrammar('go')
    off()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(codeTokenRanges(samples.go, 'go').length).toBeGreaterThan(0)
  })

  it('colours exactly like the published highlighter, embedded code included', async () => {
    for (const [lang, code] of Object.entries(samples)) {
      await loadCodeGrammar(lang)
      expect(grammarHighlighter(lang)?.tokenize(code, { lang })).toEqual(
        codeHighlighter.tokenize(code, { lang }),
      )
    }
  })

  it('ignores unknown languages', async () => {
    await loadCodeGrammar('cobol')
    expect(grammarHighlighter('cobol')).toBeNull()
  })
})
