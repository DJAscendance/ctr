'use strict';

/*
 * Remote-member registry cleanup at a world change.
 *
 * WorldBrowserPage keeps one `users` entry per remote member in the room. The
 * entry holds that member's X_ITE nodes: the `inline` that was added as a root
 * node of the world's scene, and the `import` node inside it that carries the
 * member's position and gestures. Both belong to the scene they were built in.
 *
 * The component outlives the world. A place change replaces the scene under it
 * (`browser.replaceWorld(null)`, then a fresh loadURL), but `users` was never
 * cleared, so entries from world A survived into world B still marked
 * `loaded: true` and still holding world A's nodes. onAvatarAdded skips any
 * member that is already loading or loaded, so world B's `AV:new` for that
 * member built nothing: the member stayed invisible, pinned to a node that no
 * longer belongs to any live scene.
 *
 * The registry cannot be repaired member by member on the way out, because the
 * client that leaves the old room first never receives the other member's
 * later AV:del - it has already left the room that would have carried it. The
 * whole registry has to go when the world does.
 *
 * This is the disposal half of onAvatarRemoved applied to every entry, with
 * one difference: it must always run to the end. A node whose scene is already
 * gone can throw, and one bad entry must not leave the rest of world A's
 * members in the registry, so each entry is disposed on its own.
 *
 * `browser` may be absent - the first place load has no browser yet, and a 2D
 * place never makes one. There is then nothing to detach from, and the entries
 * are still dropped.
 */
function clearRemoteMembers(users, browser) {
  const summary = { cleared: 0, failed: 0 };
  if (!users) {
    return summary;
  }
  for (const id of Object.keys(users)) {
    try {
      disposeRemoteMember(users[id], browser);
    } catch (error) {
      summary.failed += 1;
    }
    delete users[id];
    summary.cleared += 1;
  }
  return summary;
}

/*
 * Detach one member's nodes from the scene that owns them. Kept separate so
 * a throw is attributable to a single member, and so the two halves - the
 * scene detach and the node dispose - are both attempted.
 */
function disposeRemoteMember(entry, browser) {
  if (!entry) {
    return;
  }
  let firstError = null;
  if (entry.inline && browser) {
    try {
      if (typeof browser.unregisterBlaxxunAvatar === 'function') {
        browser.unregisterBlaxxunAvatar(entry.inline);
      }
      if (browser.currentScene) {
        browser.currentScene.removeRootNode(entry.inline);
      }
    } catch (error) {
      firstError = error;
    }
  }
  if (entry.import && typeof entry.import.dispose === 'function') {
    try {
      entry.import.dispose();
    } catch (error) {
      if (!firstError) firstError = error;
    }
  }
  if (firstError) {
    throw firstError;
  }
}

module.exports = {
  clearRemoteMembers: clearRemoteMembers,
  disposeRemoteMember: disposeRemoteMember,
};
