import { describe, expect, it } from 'vitest'

import { fenceOpenerLanguage, indentCode, outdentCode } from './code-block-text'

describe('indentCode (Tab)', () => {
  it('inserts two spaces at a cursor', () => {
    expect(indentCode('ab', 1, 1)).toEqual({
      from: 1,
      to: 1,
      text: '  ',
      selectionFrom: 3,
      selectionTo: 3,
    })
  })

  it('indents every line a selection touches', () => {
    expect(indentCode('a\nb\nc', 0, 3)).toEqual({
      from: 0,
      to: 3,
      text: '  a\n  b',
      selectionFrom: 0,
      selectionTo: 7,
    })
  })

  it('leaves a line out when the selection ends at its start', () => {
    // Selection from "a" through the newline, ending at column 0 of "b".
    expect(indentCode('a\nb\nc', 0, 2)?.text).toBe('  a')
    expect(indentCode('a\nb\nc', 0, 4)?.text).toBe('  a\n  b')
  })

  it('indents the whole line for a selection inside one line', () => {
    expect(indentCode('one\ntwo', 5, 6)).toMatchObject({
      from: 4,
      to: 7,
      text: '  two',
    })
  })
})

describe('outdentCode (Shift+Tab)', () => {
  it('removes up to two leading spaces from the cursor line', () => {
    expect(outdentCode('  a', 2, 2)).toEqual({
      from: 0,
      to: 3,
      text: 'a',
      selectionFrom: 0,
      selectionTo: 0,
    })
  })

  it('removes only the spaces that exist', () => {
    expect(outdentCode(' a', 1, 1)?.text).toBe('a')
  })

  it('keeps the cursor on its character after the removal', () => {
    // Cursor after "a" on the second line ("  a|"): two spaces go, cursor moves.
    expect(outdentCode('x\n  a', 5, 5)).toMatchObject({
      text: 'a',
      selectionFrom: 3,
    })
  })

  it('outdents each selected line by up to two spaces', () => {
    // The selection reaches column 1 of the third line, so all lines count.
    expect(outdentCode('    a\n b\nc', 0, 8)).toMatchObject({
      from: 0,
      to: 8,
      text: '  a\nb',
      selectionFrom: 0,
      selectionTo: 5,
    })
  })

  it('returns null when no selected line has leading spaces', () => {
    expect(outdentCode('a\nb', 0, 3)).toBeNull()
    expect(outdentCode('a', 0, 0)).toBeNull()
  })
})

describe('fenceOpenerLanguage', () => {
  it.each([
    ['```ts', 'ts'],
    ['```', ''],
    ['~~~python', 'python'],
    ['```c++', 'c++'],
    ['``` ts', 'ts'],
  ])('reads %j as %j', (input, language) => {
    expect(fenceOpenerLanguage(input)).toBe(language)
  })

  it.each(['hello', '``ts', 'x ```ts', '```ts extra'])(
    'does not treat %j as a fence',
    (input) => {
      expect(fenceOpenerLanguage(input)).toBeNull()
    },
  )
})
