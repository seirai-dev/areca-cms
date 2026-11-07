import { CODE_LANGUAGES } from '#/lib/highlight'

/**
 * Agent-facing wording for rich text code. The language ids come from the
 * editor's list (CODE_LANGUAGES), so the instructions, the field formats and
 * the unknown-language warning name the same ids. `plaintext` is left out of
 * the list: it means no language, which agents write as a fence with no name.
 */
export const CODE_FENCE_LANGUAGES: ReadonlyArray<string> =
  CODE_LANGUAGES.filter((language) => language.id !== 'plaintext').map(
    (language) => language.id,
  )

const CODE_FENCE_LANGUAGE_LIST = CODE_FENCE_LANGUAGES.join(', ')

/** Server instructions, first rich text line: Markdown with code. */
export const RICH_TEXT_MARKDOWN_INSTRUCTION =
  'Write rich text fields as Markdown (headings ##, lists, links, ![alt](asset:<assetId>) images, `inline code` in backticks, and fenced code blocks with a language). Do not send HTML. Link to another page of this site with [text](entry:<id>), using the id from list_entries or get_entry. For a section of that page, add #anchor: [text](entry:<id>#origin). A site path such as /coffees/slug also works and becomes an entry link. Never write a full URL of this site.'

/** Server instructions, second rich text line: code goes in fences. */
export const CODE_BLOCK_INSTRUCTION =
  'Put code, commands, file contents and config in fenced blocks with a language (```ts); use backticks for inline code such as function names, file paths and CLI flags. Never paste code as plain paragraphs. Fence languages: ' +
  CODE_FENCE_LANGUAGE_LIST +
  '. Use plaintext for plain text. Any other language is saved without colours, and the result lists a warning.'

/** The richtext format in get_collection_schema, after the Markdown description. */
export const CODE_FORMAT =
  'Inline code goes in backticks, e.g. `npm install`. Code, commands and config go in fenced blocks with a language, e.g. ```ts, never as plain paragraphs. Fence languages: ' +
  CODE_FENCE_LANGUAGE_LIST +
  ' (plaintext for plain text). Other languages are saved without colours and the result warns.'
