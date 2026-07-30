/**
 * Confirmed-JOIN protocol, kept dependency-free (no `@/` aliased imports)
 * so it can be unit-tested directly under plain Node/tsc without needing
 * webpack's module resolution.
 */

/** Minimal shape `joinRoomOverSocket` needs - satisfied by a real socket.io
 * Socket, and by a plain Node EventEmitter in tests. */
export interface EmitterLike {
  on(event: string, callback: (...args: any[]) => void): any;
  off(event: string, callback: (...args: any[]) => void): any;
  emit(event: string, ...args: any[]): any;
}

export const DEFAULT_JOIN_TIMEOUT_MS = 10000;

/** Upper bound on a client-supplied joinId, mirroring the server-side check. */
export const MAX_JOIN_ID_LENGTH = 128;

/**
 * A single in-flight transport JOIN attempt. `promise` settles when the
 * server confirms (ROOM_STATE) or rejects (JOIN:error/timeout); `cancel`
 * lets the owner supersede or abandon the attempt (e.g. on a newer room
 * request or a transport drop) - cancelling rejects `promise` with the
 * given reason so the owner can distinguish it from a real failure.
 */
export interface JoinHandle {
  promise: Promise<void>;
  cancel: (reason?: string) => void;
}

/** True for a non-empty, length-bounded joinId string (client + server agree). */
export function isValidJoinId(joinId: unknown): joinId is string {
  return typeof joinId === "string" && joinId.length > 0 && joinId.length <= MAX_JOIN_ID_LENGTH;
}

/**
 * Emits JOIN and waits for the server's authoritative confirmation - either
 * a ROOM_STATE for the room AND joinId we asked for, or an explicit
 * JOIN:error for that same attempt. Correlating on both room and joinId
 * means a stale response from a superseded attempt can never settle a newer
 * one. Resolving merely because JOIN was emitted (the original behavior) let
 * readiness flip to "ready" on an invalid token or dropped request; this
 * makes readiness conditional on a real, correlated server response, with a
 * timeout so a lost response can't hang a single attempt forever.
 *
 * Returns a {@link JoinHandle} rather than a bare promise so the caller can
 * cancel the attempt without treating cancellation as a JOIN failure.
 */
export function joinRoomOverSocket(
  socket: EmitterLike,
  roomId: string | number,
  token: string,
  presenceId: string,
  joinId: string,
  timeoutMs: number = DEFAULT_JOIN_TIMEOUT_MS,
): JoinHandle {
  let settled = false;
  let resolveFn: () => void = () => undefined;
  let rejectFn: (err: Error) => void = () => undefined;

  const promise = new Promise<void>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });

  const cleanup = () => {
    socket.off("ROOM_STATE", onRoomState);
    socket.off("JOIN:error", onError);
    clearTimeout(timer);
  };
  const onRoomState = (event: { room?: string | number; joinId?: string }) => {
    if (settled) return;
    // Must match BOTH the room we asked for and this exact attempt's joinId.
    // A ROOM_STATE for a different room or a different (older) attempt is a
    // stale/unrelated response and must not confirm this one.
    if (`${event?.room}` !== `${roomId}`) return;
    if (event?.joinId !== joinId) return;
    settled = true;
    cleanup();
    resolveFn();
  };
  const onError = (event: { room?: string | number; joinId?: string; reason?: string }) => {
    if (settled) return;
    // Reject only the attempt this error correlates to (same room + joinId);
    // a stale JOIN:error must not reject a newer attempt.
    if (`${event?.room}` !== `${roomId}`) return;
    if (event?.joinId !== joinId) return;
    settled = true;
    cleanup();
    rejectFn(new Error(`JOIN failed: ${event?.reason || "unknown"}`));
  };
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    cleanup();
    rejectFn(new Error("JOIN timed out waiting for server confirmation"));
  }, timeoutMs);

  const cancel = (reason = "superseded") => {
    if (settled) return;
    settled = true;
    cleanup();
    // Reason is carried in the message so the owner can tell an intentional
    // cancel (superseded / disconnected / cleared) from a real failure.
    rejectFn(new Error(`JOIN cancelled: ${reason}`));
  };

  socket.on("ROOM_STATE", onRoomState);
  socket.on("JOIN:error", onError);
  socket.emit("JOIN", { room: roomId, token, presenceId, joinId });

  return { promise, cancel };
}
