import Vue from "vue";

/**
 * Restores `<router-link>`'s element under `@vue/compat`.
 *
 * Vue Router 3's `RouterLink.render` decides between its two APIs by reading a Vue 2
 * internal marker:
 *
 * ```js
 * var scopedSlot =
 *   !this.$scopedSlots.$hasNormal &&
 *   this.$scopedSlots.default &&
 *   this.$scopedSlots.default({ href, route, navigate, isActive, isExactActive });
 * if (scopedSlot) {
 *   if (scopedSlot.length === 1) return scopedSlot[0];
 * }
 * ```
 *
 * Vue 2 set `$hasNormal` on `$scopedSlots` whenever a component was given an ordinary,
 * non-scoped slot, so `<router-link to="/x">Text</router-link>` short-circuited that test
 * and fell through to the branch that returns `h(this.tag, data, this.$slots.default)` -
 * a real `<a>`. Vue 3 has one slot kind, and `@vue/compat` rebuilds `$scopedSlots` without
 * the marker. The test therefore passes, the default slot is invoked as if it were scoped,
 * it yields exactly one child, and `RouterLink` returns that child INSTEAD of the anchor.
 *
 * The visible result is that every link renders as bare text with no `<a>`, no `href` and
 * no click handler: the City Map's places, the sidebar's Upload and Logout, and every other
 * `<router-link>` in the app.
 *
 * Forcing the marker on is safe here because this app uses only the plain form of
 * `<router-link>` - no `v-slot`, no `slot-scope`, no `custom` and no `tag` prop - so the
 * scoped branch is one Vue 2 never took either. Should a scoped `<router-link>` ever be
 * added, this shim must go and Vue Router 4 (which wraps `v-slot` content in an `<a>` by
 * default) is the real answer.
 *
 * The patch wraps `render` rather than assigning to `$scopedSlots`: `@vue/compat` exposes
 * that property through a getter that rebuilds its object, so a write would not survive to
 * the next of the three reads above. A per-call proxy answers all three consistently.
 */
export default function installRouterLinkCompat(): void {
  const routerLink = (Vue as any).component("RouterLink");
  if (!routerLink || typeof routerLink.render !== "function" || routerLink.__ctrAnchorFix) {
    return;
  }

  const originalRender = routerLink.render;

  routerLink.render = function render(this: any, h: unknown): unknown {
    const withNormalSlotMarker = new Proxy(this, {
      get(target: any, property: string | symbol): unknown {
        if (property === "$scopedSlots") {
          return { ...(target.$scopedSlots || {}), $hasNormal: true };
        }
        return target[property];
      },
    });
    return originalRender.call(withNormalSlotMarker, h);
  };

  routerLink.__ctrAnchorFix = true;
}
