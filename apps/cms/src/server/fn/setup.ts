import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { completeSetup, getSetupStatus } from '#/server/admin/setup'
import { MAIL_LOCALES } from '#/server/mail/render/types'

const setupFn = { strict: { output: false } as const }

export const getSetupStatusFn = createServerFn({
  method: 'GET',
  ...setupFn,
}).handler(async () => getSetupStatus())

export const completeSetupFn = createServerFn({ method: 'POST', ...setupFn })
  .validator(
    z.object({
      name: z.string().min(1),
      email: z.email(),
      password: z.string().min(8),
      setupToken: z.string().min(1),
      locale: z.enum(MAIL_LOCALES).optional(),
    }),
  )
  .handler(async ({ data }) => completeSetup(data))
