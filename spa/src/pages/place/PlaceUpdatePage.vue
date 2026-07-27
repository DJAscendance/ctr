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
 */
export default Vue.extend({
  name: "PlaceUpdatePage",
  components: { PlaceUpdateHub },
  props: {
    tier: { type: String, required: true },
  },
  data() {
    return {
      placeId: 0,
      unresolved: false,
    };
  },
  methods: {
    async resolvePlaceId(): Promise<void> {
      const param = this.$route.params.id;
      if (this.tier !== "colony") {
        const parsed = Number.parseInt(param, 10);
        if (Number.isNaN(parsed)) {
          this.unresolved = true;
          return;
        }
        this.placeId = parsed;
        return;
      }
      try {
        const response = await this.$http.get(`/place/${param}`);
        const place = response.data.place;
        if (!place || !place.id) {
          this.unresolved = true;
          return;
        }
        this.placeId = place.id;
      } catch (e) {
        this.unresolved = true;
      }
    },
  },
  mounted(): void {
    this.resolvePlaceId();
  },
});
</script>
