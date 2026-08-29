/**
 * What a machine did, as it happens and afterwards.
 *
 * One stream, two audiences. Whoever is watching gets it live over a socket;
 * the control plane gets it in batches and keeps it, because the screen is
 * ephemeral and the record is not. A run nobody watched must still be
 * reviewable, which is why nothing here depends on a watcher being attached.
 *
 * Output is clipped per event and the record is capped per boot: a timeline
 * that grows without bound stops being a record and becomes a cost.
 */

export type VmEventKind =
  | 'boot'
  | 'wake'
  | 'exec'
  | 'output'
  | 'exit'
  | 'sleep'
  | 'error'
  | 'egress_denied'
  | 'takeover'
  | 'release'

export interface VmEvent {
  seq: number
  kind: VmEventKind
  at: string
  payload: Record<string, unknown>
}

/** One event's worth of output. Enough to read; the whole of it is in the machine's files. */
export const MAX_EVENT_TEXT = 4_000
/** Events kept per boot. Past this the timeline records that it stopped recording. */
export const MAX_EVENTS_PER_BOOT = 2_000

function base64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

export function clipText(text: string): string {
  return text.length > MAX_EVENT_TEXT ? `${text.slice(0, MAX_EVENT_TEXT)}\n… clipped` : text
}

/**
 * Sequencing, fan-out and batching for one machine.
 *
 * `seq` is assigned here rather than by the control plane so the order survives
 * a batch arriving late or out of turn — the record is the machine's account of
 * itself, and it is the machine that knows what happened first.
 */
export class EventStream {
  private seq = 0
  private dropped = 0
  private pending: VmEvent[] = []
  private readonly watchers = new Set<WebSocket>()

  constructor(private readonly onFlush: (events: VmEvent[]) => void) {}

  attach(socket: WebSocket): void {
    this.watchers.add(socket)
  }

  detach(socket: WebSocket): void {
    this.watchers.delete(socket)
  }

  get watching(): number {
    return this.watchers.size
  }

  emit(kind: VmEventKind, payload: Record<string, unknown> = {}): VmEvent | null {
    if (this.seq >= MAX_EVENTS_PER_BOOT) {
      if (this.dropped === 0) {
        // Say so once, in the record itself: a timeline that silently stops is
        // worse than one that admits where it stopped.
        this.dropped = 1
        return this.push('error', { message: `the timeline stopped after ${MAX_EVENTS_PER_BOOT} events` })
      }
      this.dropped += 1
      return null
    }
    return this.push(kind, payload)
  }

  private push(kind: VmEventKind, payload: Record<string, unknown>): VmEvent {
    const event: VmEvent = { seq: this.seq++, kind, at: new Date().toISOString(), payload }
    this.pending.push(event)

    // A watcher that has gone away must never hold up the machine.
    for (const socket of this.watchers) {
      try {
        socket.send(JSON.stringify(event))
      } catch {
        this.watchers.delete(socket)
      }
    }
    return event
  }

  /**
   * A frame goes to whoever is watching and NOWHERE else. It is not an event:
   * the screen is ephemeral by design, and storing a picture of every second of
   * every run would be both the largest cost in the system and the most
   * sensitive thing in it.
   */
  frame(jpeg: ArrayBuffer): void {
    if (this.watchers.size === 0) return
    const message = JSON.stringify({
      seq: -2,
      kind: 'frame',
      at: new Date().toISOString(),
      payload: { jpeg: base64(jpeg) },
    })
    for (const socket of this.watchers) {
      try {
        socket.send(message)
      } catch {
        this.watchers.delete(socket)
      }
    }
  }

  /** Hand the batch to the control plane. Returns what was taken, for waitUntil. */
  flush(): void {
    if (this.pending.length === 0) return
    const batch = this.pending
    this.pending = []
    this.onFlush(batch)
  }
}
