import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { db } from '#/db'
import { organization } from '#/db/schema'
import {
  addMember,
  createTestSite,
  makeUser,
  removeUsers,
} from '#/server/notifications/test-utils'

import { membershipRole, membershipRoles, orgRoleOf } from './org-role'

const cleanups: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const run of cleanups.splice(0).reverse()) await run()
})

async function setup() {
  const { org, actor } = await createTestSite()
  const owner = await makeUser()
  const editor = await makeUser()
  const admin = await makeUser({ agencyAdmin: true })
  const memberAdmin = await makeUser({ agencyAdmin: true })
  const outsider = await makeUser()
  await addMember(owner.id, org.id, 'owner')
  await addMember(editor.id, org.id, 'editor')
  await addMember(memberAdmin.id, org.id, 'editor')
  const users = { owner, editor, admin, memberAdmin, outsider }
  cleanups.push(async () => {
    await db.delete(organization).where(eq(organization.id, org.id))
    await removeUsers([actor.id, ...Object.values(users).map((u) => u.id)])
  })
  return { org, ...users }
}

describe('org roles', () => {
  it('reads membership roles for several users in one call', async () => {
    const { org, owner, editor, outsider, memberAdmin } = await setup()
    const roles = await membershipRoles(org.id, [
      owner.id,
      editor.id,
      outsider.id,
      memberAdmin.id,
    ])
    expect(Object.fromEntries(roles)).toEqual({
      [owner.id]: 'owner',
      [editor.id]: 'editor',
      [memberAdmin.id]: 'editor',
    })
    expect(await membershipRole(outsider.id, org.id)).toBeNull()
    expect(await membershipRoles(org.id, [])).toEqual(new Map())
  })

  it('lets agency admin status win over a membership', async () => {
    const { org, owner, admin, memberAdmin, outsider } = await setup()
    expect(await orgRoleOf(owner, org.id)).toBe('owner')
    expect(await orgRoleOf(admin, org.id)).toBe('agency')
    expect(await orgRoleOf(memberAdmin, org.id)).toBe('agency')
    expect(await orgRoleOf(outsider, org.id)).toBeNull()
  })
})
