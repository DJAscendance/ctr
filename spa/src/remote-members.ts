/**
 * The Outlands remote-member adapter.
 *
 * Gameplay code (Outlands free-play, and anything else that needs to know who
 * else is in the room and where they are standing) must not know how identity
 * is carried on the wire. The accepted-line gameplay was written against a
 * registry keyed by `socket.id`; Beta's authoritative identity is the logical
 * presence key `memberId:presenceId`. This module is the only place that
 * difference is resolved, so the gameplay port later changes its imports and
 * nothing else.
 *
 * What it adds on top of {@link PresenceStore}, which stays authoritative:
 *
 *  - "remote" means "not me". The local user is in ROOM_STATE (the client
 *    filters itself out by logical key), and gameplay must never render,
 *    target, or count itself as an opponent.
 *  - A rendered-node binding. An Outlands weapon ray comes back as an X3D node,
 *    not as an id, so the registry has to answer "which citizen is this node?".
 *    The binding is held here rather than in the renderer so the ray lookup and
 *    the presence lifecycle cannot drift apart: when a presence is removed, its
 *    node binding goes with it in the same call.
 *  - A single clear for a world change. A place change replaces the scene under
 *    the component, and every node binding belongs to the scene it was built in.
 *
 * Deliberately NOT here: anything that renders, anything that shoots, and
 * anything that talks to the socket. This module is pure state plus a Map from
 * node to key. Keep it dependency-free (only `./presence`) so the Node test
 * harness can drive it directly.
 */

import {
  Presence,
  PresenceStore,
  Position3,
  Rotation4,
  presenceKey,
  isSelfPresence,
} from "./presence";

/**
 * One remote citizen as gameplay sees it.
 *
 * `pos` / `rot` are optional ON PURPOSE and must stay that way. A presence can
 * exist before it has ever reported a world-space transform, and "no valid
 * position yet" is not "standing at the origin" - the server no longer
 * fabricates `[0,0,0]` for it. Gameplay must treat an absent transform as
 * "not placeable yet" (do not render, do not target) rather than defaulting it.
 */
export interface RemoteMember {
  /** The stable render/target key: `memberId:presenceId`. Never socket.id. */
  key: string;
  memberId: number;
  presenceId: string;
  /** Current transport id. Metadata only - it changes on every reconnect. */
  socketId?: string;
  username: string;
  avatar?: any;
  pos?: Position3;
  rot?: Rotation4;
}

/** Who the local user is, read lazily so a late login still resolves. */
export interface SelfIdentity {
  memberId: number | string;
  presenceId: string;
}

export type RemoteChange =
  | { type: "add"; member: RemoteMember }
  | { type: "update"; member: RemoteMember }
  | { type: "remove"; key: string; member: RemoteMember };

// The base no-unused-vars rule cannot see a TS function-type parameter, which
// is a name in a type, not a binding.
// eslint-disable-next-line no-unused-vars
export type RemoteChangeListener = (change: RemoteChange) => void;

function toRemoteMember(presence: Presence): RemoteMember {
  return {
    key: presenceKey(presence.memberId, presence.presenceId),
    memberId: presence.memberId,
    presenceId: presence.presenceId,
    socketId: presence.socketId,
    username: presence.username,
    avatar: presence.avatar,
    pos: presence.pos,
    rot: presence.rot,
  };
}

export class RemoteMemberRegistry {
  private store: PresenceStore | null = null;
  private unsubscribeStore: (() => void) | null = null;
  private readonly identity: () => SelfIdentity;
  private readonly listeners = new Set<RemoteChangeListener>();

  /** key -> the scene node currently standing for that citizen. */
  private nodeByKey = new Map<string, any>();
  /** The same binding the other way round, for the ray lookup. */
  private keyByNode = new Map<any, string>();

  constructor(identity: () => SelfIdentity) {
    this.identity = identity;
  }

  // ---- lifecycle -----------------------------------------------------------

  /**
   * Points the registry at the room's authoritative store. Attaching drains
   * whatever the store already holds (a ROOM_STATE that landed before gameplay
   * was ready is not lost) and then follows it live.
   *
   * WorldBrowserPage builds a FRESH PresenceStore per place, so attach is
   * called again on every place load; the previous subscription and every node
   * binding from the old scene are dropped first.
   */
  public attach(store: PresenceStore): void {
    this.detach();
    this.store = store;
    this.unsubscribeStore = store.subscribe(event => {
      if (event.type === "remove") {
        // The node binding dies with the presence, in the same call - a
        // gameplay ray must never resolve to a citizen who has left.
        this.unbindNode(event.key);
        if (this.isSelf(event.presence)) return;
        this.emit({ type: "remove", key: event.key, member: toRemoteMember(event.presence) });
        return;
      }
      if (this.isSelf(event.presence)) return;
      this.emit({ type: event.type, member: toRemoteMember(event.presence) });
    });
    this.listRemoteMembers().forEach(member => this.emit({ type: "add", member }));
  }

  /** Stops following the store and drops every node binding. */
  public detach(): void {
    if (this.unsubscribeStore) this.unsubscribeStore();
    this.unsubscribeStore = null;
    this.store = null;
    this.clearRemoteMembers();
  }

  /** Subscribes to add/update/remove of REMOTE citizens. Returns unsubscribe. */
  public onRemoteChange(listener: RemoteChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(change: RemoteChange): void {
    this.listeners.forEach(listener => listener(change));
  }

  private isSelf(presence: { memberId: number | string; presenceId: string }): boolean {
    const me = this.identity();
    // Written out rather than `== null`: the identity is read lazily, so before
    // login it can legitimately be absent, and treating that as "everyone is me"
    // would hide the whole room.
    if (!me) return false;
    if (me.memberId === null || me.memberId === undefined) return false;
    if (!me.presenceId) return false;
    return isSelfPresence(presence, me.memberId, me.presenceId);
  }

  // ---- the operations the Outlands port needs -------------------------------

  /** Every remote citizen in the room right now. Never includes the local user. */
  public listRemoteMembers(): RemoteMember[] {
    if (!this.store) return [];
    return this.store
      .all()
      .filter(presence => !this.isSelf(presence))
      .map(toRemoteMember);
  }

  /** One remote citizen by key, or undefined (including for the local user). */
  public getRemoteMember(key: string): RemoteMember | undefined {
    if (!this.store) return undefined;
    const presence = this.store.get(key);
    if (!presence || this.isSelf(presence)) return undefined;
    return toRemoteMember(presence);
  }

  /**
   * Adds or merges a remote citizen. Repeated calls for the same key collapse
   * onto one record - one presence, one rendered representation.
   */
  public upsertRemoteMember(presence: Presence): RemoteMember | undefined {
    if (!this.store) return undefined;
    const merged = this.store.upsert(presence);
    return this.isSelf(merged) ? undefined : toRemoteMember(merged);
  }

  /**
   * Applies a transform. `pos` and `rot` are applied independently, so a
   * rotation-only update never erases a known position, and an update carrying
   * neither leaves the citizen with no position at all rather than an invented
   * one.
   */
  public updateRemoteTransform(
    key: string, pos?: Position3, rot?: Rotation4,
  ): RemoteMember | undefined {
    if (!this.store) return undefined;
    const updated = this.store.updateTransform(key, pos, rot);
    if (!updated || this.isSelf(updated)) return undefined;
    return toRemoteMember(updated);
  }

  /** Removes a remote citizen and its node binding. */
  public removeRemoteMember(key: string): RemoteMember | undefined {
    const removed = this.store ? this.store.remove(key) : undefined;
    this.unbindNode(key);
    if (!removed || this.isSelf(removed)) return undefined;
    return toRemoteMember(removed);
  }

  /**
   * Drops every node binding. Called at a world change: the nodes belong to the
   * scene being replaced, so keeping them would leave gameplay holding handles
   * into a scene that no longer exists. The presence store itself is replaced
   * by WorldBrowserPage, so this does not touch it.
   *
   * @returns how many bindings were dropped, for a gate to assert against.
   */
  public clearRemoteMembers(): { cleared: number } {
    const cleared = this.nodeByKey.size;
    this.nodeByKey.clear();
    this.keyByNode.clear();
    return { cleared };
  }

  // ---- ray target lookup ---------------------------------------------------

  /**
   * Records which scene node currently stands for a citizen.
   *
   * Rebinding a key replaces the old node (an avatar reloaded in place must not
   * leave its previous node answering to the same citizen), and binding a node
   * that is already claimed releases the earlier claim, so the two maps can
   * never disagree about who a node belongs to.
   */
  public bindRemoteNode(key: string, node: any): void {
    if (!key || !node) return;
    const previousNode = this.nodeByKey.get(key);
    if (previousNode && previousNode !== node) this.keyByNode.delete(previousNode);
    const previousKey = this.keyByNode.get(node);
    if (previousKey && previousKey !== key) this.nodeByKey.delete(previousKey);
    this.nodeByKey.set(key, node);
    this.keyByNode.set(node, key);
  }

  /** Releases a citizen's node binding. Safe to call for an unbound key. */
  public unbindNode(key: string): any {
    const node = this.nodeByKey.get(key);
    if (node === undefined) return undefined;
    this.nodeByKey.delete(key);
    this.keyByNode.delete(node);
    return node;
  }

  /** The node currently standing for a citizen, if one is bound. */
  public getRemoteNode(key: string): any {
    return this.nodeByKey.get(key);
  }

  /** The citizen key a scene node stands for - the combat-ray lookup. */
  public remoteKeyForNode(node: any): string | undefined {
    if (!node) return undefined;
    return this.keyByNode.get(node);
  }

  /**
   * The citizen a ray hit, resolved from the node it hit.
   *
   * Node-first, not username-first, and that is the whole point: two tabs of
   * one member are two distinct citizens sharing one username, so a name lookup
   * cannot say which of them was hit. The historical blaxxun beamer compares
   * nicknames on the wire and that stays true, but the LOCAL decision of which
   * rendered citizen was struck is made on the node.
   */
  public remoteMemberForNode(node: any): RemoteMember | undefined {
    const key = this.remoteKeyForNode(node);
    return key ? this.getRemoteMember(key) : undefined;
  }

  /**
   * Every citizen wearing a username. A LIST, not one record: usernames are not
   * unique across presences (multiple tabs), so a caller that needs exactly one
   * has to disambiguate, and one that broadcasts by nickname must reach all of
   * them.
   */
  public remoteMembersForUsername(username: string): RemoteMember[] {
    if (!username) return [];
    return this.listRemoteMembers().filter(member => member.username === username);
  }

  /**
   * Citizens that have a real world-space position. The only ones a weapon ray,
   * a beam or a collision wrapper may be aimed at - everyone else has not
   * reported where they are yet, and guessing is what the no-false-position
   * rule exists to prevent.
   */
  public placeableRemoteMembers(): RemoteMember[] {
    return this.listRemoteMembers().filter(member => Array.isArray(member.pos));
  }
}
