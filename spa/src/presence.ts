/**
 * Renderer-independent presence model shared by Chat and the X_ITE avatar layer.
 *
 * Identity is intentionally split into three concepts that must never be
 * collapsed into one another:
 * - memberId: stable account identity, taken only from the verified JWT.
 * - presenceId: a random per-tab/page-instance id, generated client-side and
 *   held only in memory (never localStorage) so two tabs on the same account
 *   remain distinct presences.
 * - socketId: the current Socket.IO transport id, which is replaceable
 *   transport metadata and must never be used as a logical identity key.
 */

/** [x, y, z] - matches the wire format already used by AV pos payloads. */
export type Position3 = [number, number, number];

/** [x, y, z, angle] - matches the wire format already used by AV rot payloads. */
export type Rotation4 = [number, number, number, number];

export interface Presence {
  memberId: number;
  presenceId: string;
  socketId: string;
  username: string;
  avatar?: any;
  pos?: Position3;
  rot?: Rotation4;
}

/** Builds the logical presence key that identifies a presence across reconnects. */
export function presenceKey(memberId: number | string, presenceId: string): string {
  return `${memberId}:${presenceId}`;
}

export interface ReconcileResult {
  added: Presence[];
  updated: Presence[];
  removed: Presence[];
}

type PresenceEvent =
  | { type: "add"; presence: Presence }
  | { type: "update"; presence: Presence }
  | { type: "remove"; key: string; presence: Presence };

type PresenceListener = (event: PresenceEvent) => void;

/**
 * Authoritative, renderer-independent store of who is currently present.
 * Consumers (Chat roster, X_ITE avatar renderer) subscribe to changes and/or
 * pull the current snapshot with `all()` whenever they become ready to render
 * it — the store itself never depends on whether anyone is listening or
 * whether a 3D scene exists yet.
 */
export class PresenceStore {
  private byKey = new Map<string, Presence>();
  private listeners = new Set<PresenceListener>();

  /** Subscribes to add/update/remove events. Returns an unsubscribe function. */
  public subscribe(listener: PresenceListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: PresenceEvent): void {
    this.listeners.forEach(listener => listener(event));
  }

  public get(key: string): Presence | undefined {
    return this.byKey.get(key);
  }

  public has(key: string): boolean {
    return this.byKey.has(key);
  }

  /** All current presences. Safe to call at any time, X_ITE-ready or not. */
  public all(): Presence[] {
    return Array.from(this.byKey.values());
  }

  /**
   * Adds a presence or merges fields into an existing one (e.g. a new
   * socketId after the transport metadata changes, or an updated transform).
   * Repeated calls for the same key collapse to the latest values only.
   */
  public upsert(next: Presence): Presence {
    const key = presenceKey(next.memberId, next.presenceId);
    const existing = this.byKey.get(key);
    const merged: Presence = existing ? { ...existing, ...next } : { ...next };
    this.byKey.set(key, merged);
    this.emit({ type: existing ? "update" : "add", presence: merged });
    return merged;
  }

  /** Updates only the transform fields of an existing presence, if present. */
  public updateTransform(key: string, pos?: Position3, rot?: Rotation4): Presence | undefined {
    const existing = this.byKey.get(key);
    if (!existing) return undefined;
    if (pos) existing.pos = pos;
    if (rot) existing.rot = rot;
    this.emit({ type: "update", presence: existing });
    return existing;
  }

  public remove(key: string): Presence | undefined {
    const existing = this.byKey.get(key);
    if (!existing) return undefined;
    this.byKey.delete(key);
    this.emit({ type: "remove", key, presence: existing });
    return existing;
  }

  /** Removes everything with no per-entry events (used on place navigation). */
  public clear(): void {
    this.byKey.clear();
  }

  /**
   * Applies an authoritative snapshot (e.g. a ROOM_STATE payload): adds
   * genuinely new presences, updates existing ones in place (no duplicate
   * roster entries, no duplicate avatar loads), and removes anything present
   * locally but absent from the snapshot (clears ghosts left by a hard
   * restart or a missed disconnect).
   */
  public reconcile(snapshot: Presence[]): ReconcileResult {
    const incomingKeys = new Set(snapshot.map(p => presenceKey(p.memberId, p.presenceId)));
    const removed: Presence[] = [];

    for (const key of Array.from(this.byKey.keys())) {
      if (!incomingKeys.has(key)) {
        const gone = this.remove(key);
        if (gone) removed.push(gone);
      }
    }

    const added: Presence[] = [];
    const updated: Presence[] = [];
    for (const presence of snapshot) {
      const key = presenceKey(presence.memberId, presence.presenceId);
      const existedBefore = this.byKey.has(key);
      const result = this.upsert(presence);
      if (existedBefore) {
        updated.push(result);
      } else {
        added.push(result);
      }
    }

    return { added, updated, removed };
  }
}
