import { describe, expect, it } from 'vitest'

import { slashMatches } from './use-slash-menu'

const command = (label: string, keywords: string) => ({
  label: () => label,
  keywords,
  run: () => undefined,
})
const heading = command('Heading 2', 'heading h2 title large')
const table = command('Table', 'table grid rows columns')

describe('slashMatches', () => {
  it('lists every command for an empty query', () => {
    expect(slashMatches([heading, table], '  ')).toEqual([heading, table])
  })

  it('matches the label case-insensitively, or a keyword', () => {
    expect(slashMatches([heading, table], 'HEAD')).toEqual([heading])
    expect(slashMatches([heading, table], 'grid')).toEqual([table])
    expect(slashMatches([heading, table], 'nothing')).toEqual([])
  })
})
