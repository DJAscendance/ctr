/**
 * Owner of the room-join lifecycle, kept dependency-free (no `@/` imports, no
 * socket.io-client import) so the Node test harness can drive the real state
 * machine directly. `SocketManager` is a thin adapter that wires real socket
 * events into this coordinator; all of the correlation, superseding, reconnect
 * and readiness logic lives here.
 *
 * The central idea (issue #69) is a two-level model:
 *
 *  - A *logical intent* - "I want to be in room R" - which survives transport
 *    interruptions. Its caller-facing promise resolves once ANY correlated
 *    attempt for R gets an authoritative ROOM_STATE, and is rejected only when
 *    the intent is superseded by a newer room, explicitly cleared, or fails
 *    definitively (JOIN:error / timeout). A mere transport drop never rejects
 *    it - the intent stays pending and is retried on reconnect.
 *
 *  - Per-transport *attempts*, each a correlated `joinRoomOverSocket` call with
 *    its own joinId. Only the latest attempt for the current intent is live;
 *    older ones are invalidated so a stale settlement can never move state.
 */

import {
  EmitterLike,
  JoinHandle,
  joinRoomOverSocket,
  DEFAULT_JOIN_TIMEOUT_MS,
} from "./join-protocol";

/** Replayable readiness phase - a late-subscribing consumer can read this
 * instead of having missed the transition events. */
export type LifecyclePhase = "idle" | "joining" | "ready" | "disconnected" | "failed";

/** Transition signals emitted to lifecycle subscribers (Chat input, avatar
 * viewpoint recovery). `ready` is the first successful join; `resynced` is a
 * successful join that recovered from a prior disconnect (so only it should
 * surface a user-facing "reconnected" message). */
export type LifecycleEvent = "ready" | "disconnected" | "resynced" | "failed";

export type LifecycleListener = (event: LifecycleEvent) => void;

export interface CoordinatorDeps {
  /** The live transport (real socket.io Socket, or a fake EmitterLike in tests). */
  socket: EmitterLike;
  /** Stable per-tab presence id, reused across reconnects. */
  presenceId: string;
  /** Probe for whether the transport is currently connected. */
  isConnected: () => boolean;
  /** Mints a unique joinId per attempt (injected for deterministic tests). */
  generateJoinId: () => string;
  /** Per-attempt confirmation timeout. */
  joinTimeoutMs?: number;
  /** Optional debug sink (kept dependency-free - no `@/helpers` here). */
  debug?: (...args: any[]) => void;
}

export class ReconnectCoordinator {
  private readonly socket: EmitterLike;
  private readonly presenceId: string;
  private readonly isConnected: () => boolean;
  private readonly generateJoinId: () => string;
  private readonly joinTimeoutMs: number;
  private readonly debug: (...args: any[]) => void;

  // --- logical intent ---
  private desiredRoom: string | number | null = null;
  private desiredToken: string | null = null;
  /** Bumped whenever the logical intent changes (new room / cleared), so a
   * settlement from a prior intent can be recognised as stale and ignored. */
  private intentGeneration = 0;
  private logicalResolve: (() => void) | null = null;
  private logicalReject: ((err: Error) => void) | null = null;

  // --- current transport attempt ---
  private currentAttempt: JoinHandle | null = null;
  private pendingJoinIdValue: string | null = null;
  /** Bumped whenever an attempt is started or invalidated; a settling attempt
   * whose id no longer matches has been superseded/aborted and is ignored. */
  private activeAttemptId = 0;

  // --- readiness ---
  private phaseValue: LifecyclePhase = "idle";
  /** True once a disconnect has happened since the last successful join, so the
   * next success is reported as a recovery (`resynced`) not an initial `ready`. */
  private sawDisconnect = false;
  private readonly lifecycleListeners = new Set<LifecycleListener>();

  constructor(deps: CoordinatorDeps) {
    this.socket = deps.socket;
    this.presenceId = deps.presenceId;
    this.isConnected = deps.isConnected;
    this.generateJoinId = deps.generateJoinId;
    this.joinTimeoutMs = deps.joinTimeoutMs ?? DEFAULT_JOIN_TIMEOUT_MS;
    this.debug = deps.debug ?? (() => undefined);
  }

  // ---- observable state (replayable) ----

  public get phase(): LifecyclePhase {
    return this.phaseValue;
  }
  /** True only when the current room has been authoritatively confirmed -
   * transport connectivity alone is never enough. */
  public get roomReady(): boolean {
    return this.phaseValue === "ready";
  }
  public get pendingJoinId(): string | null {
    return this.pendingJoinIdValue;
  }
  public get currentRoom(): string | number | null {
    return this.desiredRoom;
  }

  public onLifecycle(listener: LifecycleListener): () => void {
    this.lifecycleListeners.add(listener);
    return () => this.lifecycleListeners.delete(listener);
  }

  private emitLifecycle(event: LifecycleEvent): void {
    this.lifecycleListeners.forEach(listener => listener(event));
  }

  // ---- intent API (called by SocketManager) ----

  /**
   * Records the intent to be in `room` and returns a promise that resolves
   * when the room is authoritatively joined - possibly by a later attempt if
   * the transport is down or drops mid-join. Supersedes any prior intent.
   */
  public requestRoom(room: string | number, token: string): Promise<void> {
    // A newer intent supersedes the previous one: reject its still-pending
    // caller so nobody waits forever on an abandoned room.
    this.rejectLogical(new Error("JOIN cancelled: superseded"));

    this.intentGeneration += 1;
    const generation = this.intentGeneration;
    this.desiredRoom = room;
    this.desiredToken = token;
    this.phaseValue = "joining";

    const promise = new Promise<void>((resolve, reject) => {
      this.logicalResolve = resolve;
      this.logicalReject = reject;
    });

    // Invalidate any in-flight attempt from the prior intent.
    this.abortCurrentAttempt("superseded");

    if (this.isConnected()) {
      this.startAttempt(generation);
    } else {
      // A3: do not emit a wire JOIN while disconnected - Socket.IO would buffer
      // it and flush it on reconnect, possibly against a room we no longer want.
      // The intent waits; `handleConnect` will start the attempt.
      this.debug("requestRoom while disconnected - deferring JOIN until connect", room);
    }

    return promise;
  }

  /**
   * Clears the current room intent so a later automatic reconnect cannot
   * silently rejoin an abandoned room. Optionally scoped to a specific room so
   * a stale teardown for room A cannot clear a newer intent for room B.
   */
  public clearRoomIntent(expectedRoom?: string | number): void {
    if (
      expectedRoom !== undefined &&
      this.desiredRoom !== null &&
      `${this.desiredRoom}` !== `${expectedRoom}`
    ) {
      // The intent has already moved on to a newer room - leave it alone.
      return;
    }
    this.intentGeneration += 1;
    this.desiredRoom = null;
    this.desiredToken = null;
    this.sawDisconnect = false;
    this.abortCurrentAttempt("cleared");
    this.rejectLogical(new Error("JOIN cancelled: cleared"));
    this.phaseValue = "idle";
  }

  // ---- transport events (called by SocketManager) ----

  /** A transport connection was established (initial or a reconnect). */
  public handleConnect(): void {
    if (this.desiredRoom == null || this.desiredToken == null) {
      // No room wanted yet (e.g. initial connect before the page joins) -
      // nothing to (re)join.
      return;
    }
    if (this.phaseValue === "failed") {
      // A prior attempt for this intent failed definitively (e.g. invalid
      // token). Do NOT auto-retry on reconnect - that would be an unbounded
      // retry loop against a request that cannot succeed. Recovery requires a
      // fresh requestRoom (page re-navigation / reload), which resets the phase.
      return;
    }
    this.phaseValue = "joining";
    this.startAttempt(this.intentGeneration);
  }

  /** The transport dropped. Keep the logical intent pending for auto-rejoin. */
  public handleDisconnect(): void {
    const wasDisconnected = this.phaseValue === "disconnected";
    // Abort the in-flight attempt WITHOUT rejecting the logical intent - the
    // reconnect will start a fresh attempt for the same desired room.
    this.abortCurrentAttempt("disconnected");
    if (this.desiredRoom != null) {
      this.sawDisconnect = true;
      this.phaseValue = "disconnected";
    } else {
      this.phaseValue = "idle";
    }
    // Exactly one "disconnected" per outage: a redundant disconnect while
    // already disconnected must not re-emit to lifecycle consumers.
    if (!wasDisconnected) this.emitLifecycle("disconnected");
  }

  // ---- internals ----

  private startAttempt(generation: number): void {
    if (generation !== this.intentGeneration) return; // stale intent
    if (this.desiredRoom == null || this.desiredToken == null) return;

    // Only one live attempt at a time.
    this.abortCurrentAttempt("superseded");

    const attemptId = (this.activeAttemptId += 1);
    const joinId = this.generateJoinId();
    this.pendingJoinIdValue = joinId;

    const handle = joinRoomOverSocket(
      this.socket,
      this.desiredRoom,
      this.desiredToken,
      this.presenceId,
      joinId,
      this.joinTimeoutMs,
    );
    this.currentAttempt = handle;

    handle.promise.then(
      () => {
        if (attemptId !== this.activeAttemptId) return; // superseded/aborted
        this.onAttemptSuccess(generation, joinId);
      },
      (err: Error) => {
        if (attemptId !== this.activeAttemptId) return; // intentional cancel - ignore
        this.onAttemptFailure(generation, joinId, err);
      },
    );
  }

  /**
   * Invalidates and cancels the in-flight attempt. Bumping `activeAttemptId`
   * BEFORE cancelling means the cancellation's promise rejection is recognised
   * as stale and ignored by the attached handler - so cancelling never looks
   * like a real JOIN failure.
   */
  private abortCurrentAttempt(reason: string): void {
    if (!this.currentAttempt) {
      this.pendingJoinIdValue = null;
      return;
    }
    this.activeAttemptId += 1;
    const handle = this.currentAttempt;
    this.currentAttempt = null;
    this.pendingJoinIdValue = null;
    handle.cancel(reason);
  }

  private onAttemptSuccess(generation: number, joinId: string): void {
    if (generation !== this.intentGeneration) return; // superseded intent
    if (this.pendingJoinIdValue === joinId) this.pendingJoinIdValue = null;
    this.currentAttempt = null;

    const recovered = this.sawDisconnect;
    this.sawDisconnect = false;
    this.phaseValue = "ready";

    // Resolve the original caller's logical promise (initial or via a
    // reconnect-replacement attempt) exactly once.
    const resolve = this.logicalResolve;
    this.clearLogicalSettlers();
    if (resolve) resolve();

    // `ready` on first join; `resynced` when we recovered from a disconnect,
    // so only a genuine recovery surfaces a "reconnected" message.
    this.emitLifecycle(recovered ? "resynced" : "ready");
  }

  private onAttemptFailure(generation: number, joinId: string, err: Error): void {
    if (generation !== this.intentGeneration) return; // superseded intent
    if (this.pendingJoinIdValue === joinId) this.pendingJoinIdValue = null;
    this.currentAttempt = null;

    // A real failure: JOIN:error (e.g. invalid token) or a per-attempt timeout
    // while connected. Reject the logical intent and stop - no auto-retry loop,
    // no fake readiness. Recovery requires a fresh requestRoom (e.g. the page
    // re-navigating or reloading).
    this.phaseValue = "failed";
    this.rejectLogical(err);
    this.emitLifecycle("failed");
  }

  private clearLogicalSettlers(): void {
    this.logicalResolve = null;
    this.logicalReject = null;
  }

  private rejectLogical(err: Error): void {
    const reject = this.logicalReject;
    this.clearLogicalSettlers();
    if (reject) reject(err);
  }
}
