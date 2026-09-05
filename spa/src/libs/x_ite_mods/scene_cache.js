/*
 * Keep X_ITE's shared scene cache from stranding a world load.
 *
 * X_ITE caches every EXTERNPROTO and Inline scene in one process-wide map,
 * FileLoader.sceneCache, keyed by URL. The entry is a promise, and it is
 * inserted before the file is fetched, so a second scene asking for the same
 * URL awaits the first scene's result instead of fetching again.
 *
 * The promise is settled by FileLoader.resolve, and a loader keeps only the
 * newest one. An EXTERNPROTO with a url list therefore orphans an entry: when
 * the first url fails, loadDocumentError moves on to the next url, that
 * attempt installs its own cache entry and overwrites `resolve`, and the entry
 * belonging to the failed url is left pending for the lifetime of the page.
 *
 * The Mall is the world this happens in. shopping.wrl declares the HUD and
 * Occlusion EXTERNPROTOs as
 *   [ "urn:inet:blaxxun.com:node:HUD",
 *     "http://www.blaxxun.com/vrml/protos/nodes.wrl#HUD" ]
 * Neither target exists any more, so both urn entries are stranded on the
 * first visit. On the second visit the EXTERNPROTO finds the stranded promise
 * in the cache and awaits it forever, which means the loader never calls its
 * callback, the scene's loadCount never returns to zero, FileLoader.setScene
 * never resolves, Browser.loadURL never resolves, and replaceWorld is never
 * reached. The result is a Mall with no root nodes until the page is reloaded.
 *
 * This patch settles and drops a cache entry as soon as its own attempt fails,
 * so a failed url leaves nothing behind for a later scene to wait on. It does
 * not change what is cached on success and does not suppress the load errors
 * themselves; the dead blaxxun urls still report as unreachable, exactly as
 * they do today.
 */
(function () {
  X3D.require(["x_ite/InputOutput/FileLoader"], function (FileLoader) {
    if (!FileLoader || !FileLoader.prototype) {
      console.warn("[scene_cache] FileLoader is not available; patch skipped");
      return;
    }

    const proto = FileLoader.prototype;
    const originalLoadDocumentError = proto.loadDocumentError;

    if (typeof originalLoadDocumentError !== "function") {
      console.warn("[scene_cache] FileLoader has no loadDocumentError; patch skipped");
      return;
    }

    if (originalLoadDocumentError.sceneCachePatched) {
      return;
    }

    /* The key X_ITE stores a scene under: the request url without its fragment. */
    function cacheKey(fileURL) {
      try {
        const url = new URL(fileURL);
        url.hash = "";
        return url.href;
      } catch (error) {
        return null;
      }
    }

    function releaseCacheEntry(loader) {
      // `resolve` is only set while this loader owns a cache entry, so a
      // loader that is not caching passes straight through.
      if (typeof loader.resolve !== "function") {
        return;
      }
      const key = cacheKey(loader.fileURL);
      if (key && FileLoader.sceneCache.get(key) !== undefined) {
        FileLoader.sceneCache.delete(key);
      }
      const resolve = loader.resolve;
      loader.resolve = null;
      // A waiter must be released, not left pending. null is the value X_ITE
      // already uses for "this url produced no scene".
      resolve(null);
    }

    proto.loadDocumentError = function (error) {
      releaseCacheEntry(this);
      return originalLoadDocumentError.call(this, error);
    };
    proto.loadDocumentError.sceneCachePatched = true;
  });
})();
