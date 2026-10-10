export type PendingConfirmation = { id: number }
type Waiter = PendingConfirmation & { resolve: () => void; reject: () => void }

/** Each sensitive action receives its own confirmation, in request order. */
export class StepUpQueue {
  private waiters: Waiter[] = []
  private sequence = 0
  constructor(private changed: (current: PendingConfirmation | null) => void) {}

  ask() {
    return new Promise<void>((resolve, reject) => {
      this.waiters.push({ id: ++this.sequence, resolve, reject })
      if (this.waiters.length === 1) this.changed(this.waiters[0])
    })
  }

  settle(id: number, accepted: boolean) {
    if (this.waiters[0]?.id !== id) return
    const current = this.waiters.shift()
    if (!current) return
    if (accepted) current.resolve()
    else current.reject()
    this.changed(this.waiters[0] ?? null)
  }

  dispose() {
    for (const waiter of this.waiters.splice(0)) waiter.reject()
  }
}
