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

/**
 * Emits JOIN and waits for the server's authoritative confirmation - either
 * a ROOM_STATE for the room we asked to join, or an explicit JOIN:error.
 * Resolving merely because JOIN was emitted (the previous behavior) let
 * Chat/room-ready state flip to "ready" even on an invalid token or a
 * dropped request; this makes readiness conditional on a real server
 * response, with a timeout so a lost response can't hang forever.
 */
export function joinRoomOverSocket(
  socket: EmitterLike,
  roomId: string | number,
  token: string,
  presenceId: string,
  timeoutMs: number = DEFAULT_JOIN_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      socket.off("ROOM_STATE", onRoomState);
      socket.off("JOIN:error", onError);
      clearTimeout(timer);
    };
    const onRoomState = (event: { room?: string | number }) => {
      if (settled) return;
      // A ROOM_STATE for a different room is a stale/unrelated response
      // (e.g. from a join this one superseded) - not confirmation of ours.
      if (`${event?.room}` !== `${roomId}`) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onError = (event: { reason?: string }) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`JOIN failed: ${event?.reason || "unknown"}`));
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("JOIN timed out waiting for server confirmation"));
    }, timeoutMs);

    socket.on("ROOM_STATE", onRoomState);
    socket.on("JOIN:error", onError);
    socket.emit("JOIN", { room: roomId, token, presenceId });
  });
}
