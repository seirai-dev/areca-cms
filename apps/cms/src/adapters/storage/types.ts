export interface AssetStorageAdapter {
  put: (
    key: string,
    body: Buffer | Uint8Array,
    contentType: string,
  ) => Promise<void>
  get: (
    key: string,
  ) => Promise<{ body: ReadableStream | Buffer; contentType?: string } | null>
  delete: (key: string, opts?: { signal?: AbortSignal }) => Promise<void>
}
