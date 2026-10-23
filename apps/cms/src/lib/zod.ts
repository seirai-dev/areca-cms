import { config, z } from 'zod'

// The app's Zod. Import `z` from here, not from 'zod'.
//
// Zod decides whether to build object parsers with `new Function` when a schema
// is constructed, and its probe for eval support is itself a Content-Security-
// Policy violation (the probe is caught, but browsers still report it). The
// enforced policy has no 'unsafe-eval', so interpreted parsers are used. They
// are fast enough for forms and API payloads.
//
// Module-scope schemas are built while their module evaluates. A module that
// imports `z` from here evaluates after this file, so the setting is in place
// before any schema is built. Importing from 'zod' directly would skip that.
config({ jitless: true })

export { z }
