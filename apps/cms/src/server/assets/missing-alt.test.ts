import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import { missingAltFilter } from './missing-alt'

const dialect = new PgDialect()

describe('missingAltFilter', () => {
  it('reads alt_text for the main language', () => {
    const query = dialect.sqlToQuery(missingAltFilter('en', 'en'))
    expect(query.sql).toContain('"asset"."alt_text"')
    expect(query.sql).not.toContain('alt_i18n')
    expect(query.sql).toContain("like 'image/%'")
  })

  it('treats no language as the main language', () => {
    const query = dialect.sqlToQuery(missingAltFilter(null, 'en'))
    expect(query.sql).toContain('"asset"."alt_text"')
    expect(query.sql).not.toContain('alt_i18n')
  })

  it('reads only the language entry for another language, never alt_text', () => {
    // A value that exists only through fallback to the main alt is missing.
    const query = dialect.sqlToQuery(missingAltFilter('nl', 'en'))
    expect(query.sql).toContain('"asset"."alt_i18n" ->> $')
    expect(query.sql).not.toContain('"asset"."alt_text"')
    expect(query.params).toContain('nl')
  })

  it('counts blank and null values as missing', () => {
    const query = dialect.sqlToQuery(missingAltFilter('nl', 'en'))
    expect(query.sql).toContain('coalesce(')
    expect(query.sql).toContain("~ '^\\s*$'")
    expect(query.sql).toContain(', true)')
  })
})
