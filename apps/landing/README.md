# Areca landing page

The marketing site for [arecacms.com](https://arecacms.com). A TanStack Start app that prerenders to static files, with no runtime server and no third-party requests.

```sh
pnpm --filter @areca/landing dev        # http://localhost:3200
pnpm --filter @areca/landing build      # static output in dist/client
pnpm --filter @areca/landing preview    # serve dist/client like a static host
```

## Structure

- `src/routes/index.tsx` puts the sections together. Each section is in `src/components/sections/`.
- `src/components/art/` holds the SVG art. `frond.ts` generates the palm fronds and is shared with the video.
- `src/lib/links.ts` has every outbound URL (docs, GitHub, demo), so domains change in one place.
- `public/shots/` holds the CMS screenshots, in pairs (`-dark` and `-light`). The page shows the one that matches the theme.
- `public/video/` holds the product tour, the hero loop and the poster. They are rendered from `video/`.

## Copy and translations

All text is in `messages/en.json` and is read through Paraglide (`m.key()`). To add a language:

1. Add the locale to `project.inlang/settings.json` and create `messages/<locale>.json`.
2. In `vite.config.ts`, change the Paraglide strategy to `['url', 'baseLocale']` and wrap requests in `paraglideMiddleware` (see the CMS app for an example).
3. Add the localized paths to the prerender `pages` list.

Code terms inside messages, like `areca pull`, are shown as inline code by `WithCode` in `src/components/ui.tsx`. Keep them untranslated.

## Theme

Dark is the default. A small inline script in `<head>` applies the stored choice before the first paint, so light mode never flashes. Colours are CSS variables in `src/styles.css`, and the `.light` class switches them.

## Refreshing screenshots and the video

See [`video/README.md`](video/README.md).
