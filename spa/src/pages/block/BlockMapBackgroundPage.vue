<template>
  <div v-if="checked" class="w-full flex-1 text-center">
    <p>
      <strong>Multimedia Wizard - {{ blockName }}</strong>
    </p>

    <place-map-background-selector
      :place-id="blockId"
      place-type="block"
      :can-edit="canEdit"
    ></place-map-background-selector>

    <p class="mt-2">
      <router-link :to="{ name: 'blockwizard' }">Back to Update Wizard</router-link>
    </p>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

import PlaceMapBackgroundSelector from "@/components/PlaceMapBackgroundSelector.vue";

/**
 * The block background step of the classic wizard.
 *
 * Authorization is read from `/block/:id/can_admin` keyed on the ROUTE id, not
 * on the `block` prop the parent route supplies. `BlockPage` fetches its place
 * once in `mounted()` and has no route watcher, so after a move between two
 * block ids the prop still describes the previous block while the URL already
 * describes the new one. Keying on the route id keeps the check and the two
 * MAP-1 requests on the same block. The server still enforces the write.
 */
export default Vue.extend({
  name: "BlockMapBackgroundPage",
  components: { PlaceMapBackgroundSelector },
  props: ["block", "hood", "colony"],
  data() {
    return {
      checked: false,
      canEdit: false,
    };
  },
  computed: {
    blockId(): string {
      return this.$route.params.id;
    },
    blockName(): string {
      return this.block ? this.block.name : "";
    },
  },
  methods: {
    async checkAdmin(): Promise<boolean> {
      try {
        await this.$http.get(`/block/${this.blockId}/can_admin`);
        return true;
      } catch (error) {
        return false;
      }
    },
  },
  async mounted(): Promise<void> {
    this.canEdit = await this.checkAdmin();
    if (!this.canEdit) {
      this.$router.push("/restricted");
      return;
    }
    this.checked = true;
    if (this.block) {
      document.title = `${this.block.name} Background - Cybertown`;
    }
  },
});
</script>
