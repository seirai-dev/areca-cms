import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { completeSetup, getSetupStatus } from '#/server/admin/setup'

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
    }),
  )
  .handler(async ({ data }) => completeSetup(data))
