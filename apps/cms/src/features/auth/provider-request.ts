/** Better Auth returns immediate failures as data rather than rejecting. */
export async function providerRequest(
  request: () => Promise<{ error: { message?: string } | null }>,
) {
  const result = await request()
  if (result.error) throw new Error(result.error.message)
}
