/** Raised when S3 stops answering in time. Callers see it instead of a bare AbortError. */
export class StorageTimeoutError extends Error {
  name = 'StorageTimeoutError'
}

/**
 * Aborts `controller` with a StorageTimeoutError after `ms`. Clear the returned
 * timer once the step it guards has finished.
 */
export function abortAfter(
  controller: AbortController,
  ms: number,
  message: string,
): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    controller.abort(new StorageTimeoutError(message))
  }, ms)
}

/**
 * The timeout that stopped a request, if one did. Otherwise the original error.
 */
export function explainAbort(controller: AbortController, error: unknown) {
  const reason: unknown = controller.signal.reason
  return reason instanceof StorageTimeoutError ? reason : error
}

/**
 * Wraps a download so that a stalled connection cannot hold a request or a
 * worker forever. The idle clock runs only while a consumer waits for the next
 * chunk, so a slow consumer is never timed out. If no chunk arrives within
 * `idleMs` the request is aborted and the stream errors. Cancelling the stream
 * aborts the request, which frees its socket.
 */
export function idleGuard(
  source: ReadableStream<Uint8Array>,
  controller: AbortController,
  idleMs: number,
  onSettled: () => void = () => {},
): ReadableStream<Uint8Array> {
  const reader = source.getReader()
  return new ReadableStream<Uint8Array>({
    async pull(out) {
      const timer = abortAfter(
        controller,
        idleMs,
        `No data from storage for ${idleMs / 1000}s`,
      )
      try {
        const { done, value } = await reader.read()
        if (done) {
          onSettled()
          out.close()
          return
        }
        out.enqueue(value)
      } catch (error) {
        onSettled()
        out.error(explainAbort(controller, error))
      } finally {
        clearTimeout(timer)
      }
    },
    cancel(reason) {
      onSettled()
      controller.abort(reason)
      // Aborting errors the source. That is the expected outcome of a cancel,
      // so it is not reported to the consumer.
      return reader.cancel(reason).catch(() => {})
    },
  })
}
