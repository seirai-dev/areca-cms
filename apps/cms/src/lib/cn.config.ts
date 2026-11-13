// Input to `pnpm cn:tables`, which compiles it into cn-tables.gen.ts. The
// browser ships those tables, not this config or the cn compiler.
export default {
  extend: {
    classGroups: {
      // The type-scale utilities (`text-display`, `text-caption`, …) set a
      // font size, not a colour. Without this the merger reads them as text
      // colours and drops them whenever a class list also sets
      // `text-text-primary`.
      'font-size': [
        {
          text: [
            'display',
            'title-1',
            'title-2',
            'headline',
            'body',
            'body-lg',
            'callout',
            'caption',
            'overline',
            'mono',
            'editor-title',
          ],
        },
      ],
      shadow: [{ shadow: ['card', 'float', 'raise'] }],
      rounded: [{ rounded: ['control', 'card', 'panel', 'thumb'] }],
    },
  },
}
