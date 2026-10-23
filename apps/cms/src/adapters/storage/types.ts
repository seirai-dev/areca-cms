export interface StorageObject {
  /**
   * The object's bytes, read as they arrive. Consume it or cancel it: until
   * then the connection to storage stays open.
   */
  body: ReadableStream<Uint8Array>
  contentType?: string
  contentLength?: number
}

export interface AssetStorageAdapter {
  put: (
    key: string,
    body: Buffer | Uint8Array,
    contentType: string,
  ) => Promise<void>
  get: (
    key: string,
    opts?: { signal?: AbortSignal },
  ) => Promise<StorageObject | null>
  delete: (key: string, opts?: { signal?: AbortSignal }) => Promise<void>
}
