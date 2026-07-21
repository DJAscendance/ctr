import * as SocketIO from "socket.io-client";

import { debugMsg } from '@/helpers';
import {
  ReconnectCoordinator,
  LifecycleEvent,
  LifecyclePhase,
} from "./reconnect-coordinator";

/**
 * Generates a random per-tab presence id. Held only in memory for the
 * lifetime of this page instance - never persisted to localStorage or
 * otherwise shared across tabs, so two tabs on the same account always
 * present as two distinct presences.
 */
function generatePresenceId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Mints a unique id for a single JOIN attempt. */
function generateJoinId(): string {
  return `j-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Thin adapter over the socket.io transport. It owns nothing about the join
 * lifecycle itself - that lives in {@link ReconnectCoordinator} - it only
 * creates the socket, forwards transport events into the coordinator, and
 * exposes the coordinator's intent API and readiness state to the Vue layer.
 */
class SocketManager {
  private socket: SocketIO.Socket;
  private coordinator: ReconnectCoordinator;
  private readonly presenceIdValue: string = generatePresenceId();

  constructor() {}

  /**
   * The random per-tab presence id for this page instance. Combined with
   * the JWT-derived member id server-side to form the logical presence key
   * `memberId:presenceId` - never the transport-level socket id. Stable
   * across reconnects for the tab's lifetime.
   */
  public get presenceId(): string {
    return this.presenceIdValue;
  }

  /**
   * Determines if the socket transport is currently connected. Note this is
   * NOT the same as room readiness - see {@link roomReady}.
   * @return `true` if a socket exists and it's connected, `false` otherwise
   */
  public get connected(): boolean {
    if (!this.socket) return false;
    return this.socket.connected;
  }

  /**
   * Whether the current room has been authoritatively confirmed (a matching
   * ROOM_STATE received). Transport connectivity alone is never enough - a
   * reconnected-but-not-yet-resynced socket reports `false`.
   */
  public get roomReady(): boolean {
    return this.coordinator ? this.coordinator.roomReady : false;
  }

  /** The current readiness phase, replayable by a late-subscribing consumer. */
  public get lifecyclePhase(): LifecyclePhase {
    return this.coordinator ? this.coordinator.phase : "idle";
  }

  /** The joinId of the in-flight attempt, or null; used to correlate the
   * persistent ROOM_STATE listener so a stale attempt can't re-reconcile. */
  public get pendingJoinId(): string | null {
    return this.coordinator ? this.coordinator.pendingJoinId : null;
  }

  /** The room the client currently intends to be in (used to room-tag AV). */
  public get currentRoom(): string | number | null {
    return this.coordinator ? this.coordinator.currentRoom : null;
  }

  /**
   * Emits the given event on the socket, if it exists.
   * @param event name of event to emit
   * @param args 0-N items to send with the event
   * @returns socket instance
   */
  public emit(event: string, ...args: any[]): SocketIO.Socket {
    if (!this.socket) return;
    return this.socket.emit(event, ...args);
  }

  /**
   * Emits a room-scoped AV (avatar movement/gesture/viewpoint) payload. Dropped
   * entirely while disconnected so nothing is buffered by Socket.IO and flushed
   * into a later room. The authoritative current room is stamped on so the
   * server can reject any AV that doesn't match the socket's current room.
   *
   * High-frequency movement is sent `volatile` (a dropped frame is harmless and
   * must never queue), but a one-shot critical send (`opts.reliable`) - notably
   * the post-reconnect viewpoint resend that restores a stationary user's
   * position on peers - must NOT be volatile, or a busy/backgrounded tab can
   * silently drop it and peers would keep the user at the origin.
   * @param payload the AV detail to broadcast
   * @param opts `reliable: true` for a one-shot that must not be dropped
   */
  public sendAv(payload: Record<string, any>, opts: { reliable?: boolean } = {}): void {
    if (!this.socket || !this.socket.connected) return; // drop while disconnected
    const room = this.coordinator ? this.coordinator.currentRoom : null;
    if (room == null) return;
    const channel = opts.reliable ? this.socket : this.socket.volatile;
    channel.emit("AV", { ...payload, room });
  }

  /**
   * Records the intent to join the room and resolves once the server confirms
   * with a matching ROOM_STATE. Unlike a raw transport emit, this intent
   * survives a mid-join disconnect: it is retried automatically on reconnect
   * and the returned promise resolves off whichever attempt succeeds. Rejects
   * only on a definitive failure (invalid token / timeout) or if superseded by
   * a newer room / cleared.
   * @param roomId id of room to join
   * @param userToken user's unique token
   * @returns promise resolved once the server confirms the (possibly retried) join
   */
  public joinRoom(roomId: string|number, userToken: string): Promise<void> {
    return this.coordinator.requestRoom(roomId, userToken);
  }

  /**
   * Clears room intent (so an automatic reconnect can't silently rejoin) and,
   * only if currently connected, tells the server to unsubscribe. A disconnected
   * transport has no live room membership to leave, so no `unsubscribe` is
   * queued (which Socket.IO would otherwise flush on reconnect).
   * @param roomId id of room to leave
   */
  public leaveRoom(roomId: string|number): void {
    if (!this.coordinator) return; // never started - nothing to leave
    const wasConnected = this.connected;
    this.coordinator.clearRoomIntent(roomId);
    if (wasConnected) this.socket.emit("unsubscribe", { room: roomId });
  }

  /**
   * Subscribes to room-readiness lifecycle transitions (disconnected / ready /
   * resynced / failed). Returns an unsubscribe function.
   */
  public onLifecycle(listener: (event: LifecycleEvent) => void): () => void {
    return this.coordinator.onLifecycle(listener);
  }

  /**
   * Registers an event handler on the socket.
   * @param event name of event
   * @param callback function to be called when event occurs
   * @returns socket instance
   */
  public on(event: string, callback: (...args: any[]) => void): SocketIO.Socket {
    return this.socket.on(event, callback);
  }

  /**
   * Removes a previously registered event handler. Needed by any listener
   * that shouldn't accumulate duplicates across repeated registration
   * (e.g. component remounts, place navigation).
   * @param event name of event
   * @param callback the exact function passed to a prior `on()` call
   * @returns socket instance
   */
  public off(event: string, callback?: (...args: any[]) => void): SocketIO.Socket {
    return this.socket.off(event, callback);
  }

  /**
   * Creates the underlying socket. Extracted so tests can inject a fake
   * transport without opening a real connection.
   */
  protected createSocket(): SocketIO.Socket {
    return SocketIO.io();
  }

  /**
   * Creates and connects a socket instance.
   * @returns promise to be resolved on connection
   */
  public start(): Promise<void> {
    if (this.socket) return;
    debugMsg("starting socket...");
    this.socket = this.createSocket();
    this.coordinator = new ReconnectCoordinator({
      socket: this.socket,
      presenceId: this.presenceIdValue,
      isConnected: () => !!this.socket && this.socket.connected,
      generateJoinId,
      debug: debugMsg,
    });
    // In socket.io v4 the reconnection-lifecycle events fire on the MANAGER
    // (`socket.io`), not the socket instance; `connect` re-fires on the socket
    // instance after every reconnect. So we drive (re)join from the instance
    // `connect` and keep the manager `reconnect` only for debug visibility.
    this.socket.on("connect", () => this.onConnect());
    this.socket.on("disconnect", () => this.onDisconnect());
    this.socket.io.on("reconnect", () => debugMsg("manager reconnect"));
    return new Promise(resolve => this.socket.on("connect", () => resolve()));
  }

  /** Connection event handler - initial connect and every reconnect. */
  private onConnect(): void {
    debugMsg('connect');
    this.coordinator.handleConnect();
  }

  /** Disconnection event handler. */
  private onDisconnect(): void {
    debugMsg('disconnected...');
    this.coordinator.handleDisconnect();
  }
}
export { SocketManager };
const socket = new SocketManager();
export default socket;
