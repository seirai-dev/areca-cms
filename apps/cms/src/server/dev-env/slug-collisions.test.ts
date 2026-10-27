import { describe, expect, it } from 'vitest'

import type { EntryData } from '#/lib/types'

import { findSlugCollisions, slugCandidates } from './slug-collisions'
import type { SlugOwner } from './slug-collisions'

const owner = (overrides: Partial<SlugOwner> = {}): SlugOwner => ({
  id: 'o1',
  title: 'Contact',
  slug: 'contact',
  draftData: {},
  ...overrides,
})

const localized = (locale: string, slug: string): EntryData => ({
  $i18n: { [locale]: { $slug: slug } },
})

describe('slugCandidates', () => {
  it('lists the main slug and each localized slug, skipping empty ones', () => {
    expect(
      slugCandidates({
        slug: 'contact',
        draftData: {
          $i18n: { nl: { $slug: 'contact-nl' }, tr: { $slug: '' } },
        },
      }),
    ).toEqual([{ slug: 'contact' }, { locale: 'nl', slug: 'contact-nl' }])
  })
})

describe('findSlugCollisions', () => {
  it('finds a main slug another entry already uses', () => {
    expect(
      findSlugCollisions({ slug: 'contact', draftData: {} }, [owner()]),
    ).toEqual([{ slug: 'contact', collidesWith: 'Contact' }])
  })

  it('finds a localized slug that another entry uses as its main slug', () => {
    expect(
      findSlugCollisions(
        { slug: 'about', draftData: localized('nl', 'contact') },
        [owner()],
      ),
    ).toEqual([{ locale: 'nl', slug: 'contact', collidesWith: 'Contact' }])
  })

  it('finds a localized slug another entry uses in the same language', () => {
    expect(
      findSlugCollisions(
        { slug: 'about', draftData: localized('nl', 'contact-nl') },
        [owner({ slug: 'over', draftData: localized('nl', 'contact-nl') })],
      ),
    ).toEqual([{ locale: 'nl', slug: 'contact-nl', collidesWith: 'Contact' }])
  })

  it('does not match a localized slug held in another language', () => {
    expect(
      findSlugCollisions(
        { slug: 'about', draftData: localized('nl', 'contact') },
        [owner({ slug: 'over', draftData: localized('tr', 'contact') })],
      ),
    ).toEqual([])
  })

  it('does not match a main slug held only as another entry localized slug', () => {
    expect(
      findSlugCollisions({ slug: 'contact', draftData: {} }, [
        owner({ slug: 'over', draftData: localized('nl', 'contact') }),
      ]),
    ).toEqual([])
  })

  it('reports each colliding URL once, against the first owner', () => {
    expect(
      findSlugCollisions(
        { slug: 'contact', draftData: localized('nl', 'contact') },
        [owner({ id: 'a', title: 'A' }), owner({ id: 'b', title: 'B' })],
      ),
    ).toEqual([
      { slug: 'contact', collidesWith: 'A' },
      { locale: 'nl', slug: 'contact', collidesWith: 'A' },
    ])
  })
})
