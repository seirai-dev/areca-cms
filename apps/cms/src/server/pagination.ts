import { z } from 'zod'

export const MAX_PAGE_SIZE = 100
export const MAX_PAGE_OFFSET = 100_000

export const pageLimitSchema = z.number().int().min(1).max(MAX_PAGE_SIZE)
export const pageOffsetSchema = z.number().int().min(0).max(MAX_PAGE_OFFSET)
