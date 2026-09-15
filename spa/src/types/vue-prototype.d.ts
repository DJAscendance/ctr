import api from "../api";
import { AppStore } from "../appStore";
import { VueWithCustomFilters } from "../helpers/fiters";
import { SocketManager } from "../socket";

/**
 * `main.ts` hangs $http, $store and $socket off the Vue prototype, and registers the custom
 * filters. This tells TypeScript about them.
 *
 * Vue 2 kept its instance interface in the `vue/types/vue` module; Vue 3 has no such module
 * and uses the `ComponentCustomProperties` interface in `@vue/runtime-core` for exactly this
 * purpose. Same three properties, same filters, new home. `Vue.prototype.$x = ...` still
 * works at runtime through @vue/compat, so nothing about the assignment side changed.
 *
 * The filters import used to point at `../filters`, a path that has not existed since the
 * helpers were moved; it silently resolved to nothing and the filter types were never
 * applied. It now points at the file that actually exports the interface.
 */
declare module "@vue/runtime-core" {
  interface ComponentCustomProperties extends VueWithCustomFilters {
    $http: api,
    $socket: SocketManager,
    $store: AppStore,
  }
}
