<template>
  <div class="h-full w-full bg-black flex flex-col p-2">
    <place-update-hub
      v-if="placeId"
      :place-id="placeId"
      :expected-type="tier"
    ></place-update-hub>
    <p v-else-if="unresolved" class="text-center text-red-500">
      Insufficient access rights.
    </p>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

import PlaceUpdateHub from "@/components/place/PlaceUpdateHub.vue";
import {
  createPlaceResolver,
  placeUpdateRouteChanged,
} from "@/helpers/place-hub-load.helper";

/**
 * Route target for every scoped Update hub.
 *
 * Its only job is resolving the place id, because the three tiers are reached by
 * differently shaped routes: `/neighborhood/:id` and `/block/:id` carry a numeric
 * place id, while `/place/:id` carries a colony SLUG. Everything after that -
 * capabilities, tools, children - is the shared PlaceUpdateHub.
 *
 * `tier` comes from the route table, not from the user, and is only used to pick
 * the resolution strategy and to assert against the type the server reports. It
 * grants nothing: authorization is decided server-side from the stored place row.
 *
 * vue-router REUSES this instance across places of the same tier, so resolving
 * only in `mounted()` left the previous place - or a previous failure - on screen
 * after every same-tier navigation. The resolution therefore lives in a
 * controller that clears its state before each load and discards answers
 * belonging to a route the member has already left; see
 * helpers/place-hub-load.helper.
 */
export default Vue.extend({
  name: "PlaceUpdatePage",
  components: { PlaceUpdateHub },
  props: {
    tier: { type: String, required: true },
  },
  data() {
    return {
      resolver: createPlaceResolver(this.$http),
    };
  },
  computed: {
    placeId(): number {
      return this.resolver.state.placeId;
    },
    unresolved(): boolean {
      return this.resolver.state.unresolved;
    },
  },
  methods: {
    reload(): void {
      this.resolver.reload(this.$route.params.id, this.tier);
    },
  },
  mounted(): void {
    this.reload();
  },
  watch: {
    /**
     * Vue 2 replaces `$route` on every navigation, so this fires once per
     * navigation without `deep`. The guard skips navigations that leave the same
     * place addressed - a query or hash change - while still catching a change of
     * tier, which can share an id with the place it replaces.
     */
    $route(to, from) {
      if (!placeUpdateRouteChanged(to, from)) return;
      this.reload();
    },
  },
});
</script>
