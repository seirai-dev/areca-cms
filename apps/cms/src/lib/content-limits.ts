/**
 * Every input-size limit for content writes and manifest syncs lives here, so
 * the numbers are reviewed in one place. Server validators import from this
 * file; nothing else should hard-code a content limit.
 */

/** Rich text: maximum nesting depth of a document (root `doc` counts as 1). */
export const RICHTEXT_MAX_DEPTH = 32
/** Rich text: maximum number of nodes in one document. */
export const RICHTEXT_MAX_NODES = 20_000
/** Rich text: maximum total characters of text across one document. */
export const RICHTEXT_MAX_TEXT_LENGTH = 200_000
/** Rich text: maximum marks on a single node. */
export const RICHTEXT_MAX_MARKS_PER_NODE = 16
/** Rich text: validation stops collecting messages after this many errors. */
export const RICHTEXT_MAX_ERRORS = 50

/** Total serialized (JSON, UTF-8) size of one entry's data. */
export const ENTRY_DATA_MAX_BYTES = 1024 * 1024

/** Per-field-type string limits (characters). */
export const TEXT_MAX_LENGTH = 1_000
export const TEXTAREA_MAX_LENGTH = 50_000
export const SLUG_MAX_LENGTH = 200
export const URL_MAX_LENGTH = 2_048
export const SELECT_VALUE_MAX_LENGTH = 500
/** Asset / entry reference IDs. */
export const ID_MAX_LENGTH = 128

/** Server-fn input bounds. */
export const SEARCH_MAX_LENGTH = 200
export const ALT_TEXT_MAX_LENGTH = 1_000
export const SCHEDULE_FIELD_MAX_LENGTH = 100
export const FIELD_LABEL_MAX_LENGTH = 200
export const FIELD_DESCRIPTION_MAX_LENGTH = 1_000
export const FIELD_OPTION_MAX_LENGTH = 200
export const FIELD_MAX_OPTIONS = 200
export const ROUTE_PATTERN_MAX_LENGTH = 500
/** A BCP 47 language tag, e.g. `nl-BE`. */
export const LOCALE_TAG_MAX_LENGTH = 35
/** Languages a site can have, main included. */
export const MAX_SITE_LANGUAGES = 20

/** Manifest / collection definition limits. */
export const MANIFEST_MAX_BYTES = 256 * 1024
export const MANIFEST_MAX_COLLECTIONS = 100
export const MAX_FIELDS_PER_COLLECTION = 100

/** Entries one bulk entry action (publish, unpublish, archive, delete) may name. */
export const BULK_ENTRY_MAX_IDS = 200
