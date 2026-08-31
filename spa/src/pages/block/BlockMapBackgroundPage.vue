<template>
  <div v-if="checked" class="w-full flex-1 text-center">
    <p>
      <strong>{{ heading }}</strong>
    </p>

    <place-map-background-selector
      :key="blockId"
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

/** The classic wizard heading, from `colonycity/templates/block/wizard/image.tmpl`. */
const WIZARD_TITLE = "Multimedia Wizard";

/**
 * The block background step of the classic wizard.
 *
 * Everything on this page is keyed on the ROUTE id, never on the `block` prop
 * the parent route supplies. `BlockPage` fetches its place once in `mounted()`
 * and has no route watcher, so after a move between two block ids that prop
 * still describes the previous block while the URL already describes the new
 * one. The name in the heading is therefore read here, from `/block/:id`, so
 * the heading, the authorization and the two MAP-1 requests all describe the
 * same block. The server still enforces the write.
 *
 * Vue Router also reuses THIS page when only `/block/:id` changes, so
 * `mounted()` does not run again either. `blockId` is watched so every id gets
 * its own authorization and its own name, and the `:key` above ties the
 * selector's lifetime to the id so no option list, pending radio or message can
 * cross into a different block.
 */
export default Vue.extend({
  name: "BlockMapBackgroundPage",
  components: { PlaceMapBackgroundSelector },
  props: ["block", "hood", "colony"],
  data() {
    return {
      checked: false,
      canEdit: false,
      blockName: "",
    };
  },
  computed: {
    blockId(): string {
      return this.$route.params.id;
    },
    /**
     * The name is omitted rather than guessed. A wrong name is worse than no
     * name, because the viewer is about to change that block's map.
     */
    heading(): string {
      return this.blockName ? `${WIZARD_TITLE} - ${this.blockName}` : WIZARD_TITLE;
    },
  },
  watch: {
    blockId(): void {
      this.authorize();
    },
  },
  methods: {
    async checkAdmin(blockId: string): Promise<boolean> {
      try {
        await this.$http.get(`/block/${blockId}/can_admin`);
        return true;
      } catch (error) {
        return false;
      }
    },
    /** Reads the name of one block. An empty result means "do not name it". */
    async loadBlockName(blockId: string): Promise<string> {
      try {
        const response = await this.$http.get(`/block/${blockId}`);
        return response.data.block.name;
      } catch (error) {
        return "";
      }
    },
    /**
     * Prepares the step for the id currently in the URL, and reveals it only
     * once that id is authorized and named.
     *
     * Everything the previous block produced is dropped first: `checked` hides
     * the step so no selector and no heading are on screen while the answers
     * are outstanding, `blockName` drops the old name so it cannot be read as
     * the new block's, and `canEdit` withdraws the write authority so an
     * authorized block can never lend its authority to the next one.
     *
     * Each reply is applied only if the URL still holds the id it was asked
     * for. Without that, a slow answer for the block the viewer just left could
     * unlock, rename, or redirect away from the block now in the URL.
     */
    async authorize(): Promise<void> {
      const blockId = this.blockId;
      this.checked = false;
      this.canEdit = false;
      this.blockName = "";
      const canEdit = await this.checkAdmin(blockId);
      if (this.blockId !== blockId) {
        return;
      }
      if (!canEdit) {
        this.$router.push("/restricted");
        return;
      }
      const blockName = await this.loadBlockName(blockId);
      if (this.blockId !== blockId) {
        return;
      }
      this.blockName = blockName;
      this.canEdit = true;
      this.checked = true;
      document.title = blockName
        ? `${blockName} Background - Cybertown`
        : "Background - Cybertown";
    },
  },
  async mounted(): Promise<void> {
    await this.authorize();
  },
});
</script>
