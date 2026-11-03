# Landing page video and screenshots

The product tour is edited in [Remotion](https://www.remotion.dev) from real recordings of the CMS. Nothing in it is mocked: the clips are Playwright sessions against the production CMS and the Northbound Coffee demo site.

## 1. Sign in once

The capture scripts reuse a saved session in `/tmp/areca-landing/auth.json`, outside the repository. Create it with either method:

- **Email and password:** `node capture/login.mjs <passwordFile> <totpPathFile> /tmp/areca-landing/auth.json`. The script stops at the 2FA screen and waits until `<totpPathFile>` contains the path of a file holding the code.
- **Session cookie:** if the instance only allows SSO, copy the `__Secure-better-auth.session_token` cookie from a signed-in browser into a Playwright storage state file.

Never commit the session file.

## 2. Record the clips

Each scene is one script in `capture/beats/`. The harness (`capture/harness.mjs`) draws a smooth cursor inside the page, records the tab through the DevTools screencast, and writes a constant 30 fps MP4 to `public/clips/`. That folder is gitignored, so record the clips again before you re-render.

```sh
node capture/beats/01-agency.mjs
node capture/beats/02-branding.mjs   # changes and saves the accent colour
node capture/beats/03-write.mjs      # creates a new coffee entry
node capture/beats/04-visual.mjs
node capture/beats/05-languages.mjs
node capture/beats/06-seo.mjs
node capture/beats/07-ready.mjs      # marks the entry ready
node capture/beats/08-golive.mjs     # starts a real release
node capture/beats/08b-building.mjs
node capture/beats/09-livesite.mjs   # also counts requests to the CMS host
```

The scripts change real content. Check the entry IDs and the branding values in the scripts before you run them against another instance.

## 3. Screenshots

`node capture/shots.mjs [names...]` captures the CMS screens used on the page, in dark and light at 2x, into `../public/shots/`.

## 4. Edit and render

- `src/edit.ts` is the edit decision list. Each scene has its clip, a caption, the parts to play with a speed each, and camera keyframes. Camera times refer to the source clip, so changing a speed does not shift the zooms.
- `pnpm --filter @areca/landing-video studio` opens Remotion Studio for previewing.
- `pnpm --filter @areca/landing-video render` renders the tour, the hero loop, the share image and the web encodes into `../public/`.

Music can be added later as an `<Audio>` track in `src/Tour.tsx`.

Remotion is free for individuals and companies with up to three employees. Larger companies need a [company license](https://www.remotion.pro/license).
