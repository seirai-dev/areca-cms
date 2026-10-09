# Screenshot notes

Screenshots are documentation assets, not proof that a deployment or test suite passed. Names, entry data, languages, themes, and controls differ with the site's configuration and the user's role.

## Current walkthrough captures

Captured on 9 October 2026 from the existing local CMS build, signed in as the seeded agency admin. The existing database contains seed and test data. Screens were explored without editing entries, changing settings, generating paid AI requests, or publishing a release. Source review supplies the documented behavior; a screenshot's older helper copy can lag server rules (notably Production publishing and the separate schema-write token).

| File | Screen |
| --- | --- |
| `two-factor-authentication.png` | Admin sign-in authenticator challenge, with no code entered |
| `current-collection.png` | Article cards and status filters |
| `current-editor-seo.png` | Saved article editor with Details and SEO section |
| `current-seo-search.png` | Search title, description, and focus keyphrase fields |
| `current-mobile-collection.png` | Article collection in a phone-sized viewport |
| `current-editor-answers.png` | Editor with the AI answers group expanded |
| `current-developer-settings.png` | Site key, read token, schema-write token, and connection commands |
| `current-deployment-settings.png` | Production/Demo selection and deployment target controls |
| `current-content-schema.png` | Content type's field editor |
| `current-agency-ai.png` | OpenRouter connection and model/prompt configuration; credential masked |
| `current-branding.png` | CMS branding settings and appearance preview |
| `current-library.png` | Organization media library |
| `current-people.png` | Client members and roles |
| `current-releases.png` | Go-live review, failed-release explanation, and release history |

Images record the actual seeded screen, including test titles and an existing failed release. Those are example data, not instructions to reproduce a failure. Provider/model names shown are the local instance's selection, not recommendations.

## Earlier reference images

The root `*-light.png` / `*-dark.png` files and `redesign/` captures predate this documentation pass. They show the established desktop/mobile layouts and remain useful as visual references. They may omit newer SEO/AI controls or show older wording. Use the current guides for permissions, credential scope, and publishing behavior.

## Updating a capture

Wait for data and loading placeholders to settle. Use a representative existing screen; keep passwords, bearer tokens, preview tokens, recovery codes, QR secrets, and private customer content out of the image. Save the PNG under this directory, update its guide's alt text, and record the capture context here. Preserve older reference images that are still linked.
