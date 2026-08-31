<template>
  <div v-if="checked" class="w-full flex-1 text-center">
    <p>
      <strong>{{ heading }}</strong>
    </p>

    <place-map-background-selector
      :key="hoodId"
      :place-id="hoodId"
      place-type="hood"
      :can-edit="canEdit"
    ></place-map-background-selector>

    <p class="mt-2">
      <router-link :to="{ name: 'neighborhoodpage' }">Back to the Neighborhood</router-link>
    </p>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

import PlaceMapBackgroundSelector from "@/components/PlaceMapBackgroundSelector.vue";

/**
 * The classic wizard heading, from
 * `colonycity/templates/neighbor/wizard/image.tmpl`.
 */
const WIZARD_TITLE = "Multimedia Wizard";

/**
 * The neighborhood background step of the classic wizard (MAP-3).
 *
 * The original workflow is not inferred from the block one; it is recorded in
 * the preserved system. `neighbor/action_standard.tmpl` puts an "Update" button
 * behind `owneraccess`, that button opens `neighbor?ac=wizardplace`, whose
 * `wizardinfo` frame links to `neighbor?ac=wizardimage`, and that page is
 * `neighbor/wizard/image.tmpl`. The production `:80` access logs show the whole
 * chain being used: 82 real requests to `neighbor?ac=wizardimage`, and one
 * complete write on 28/Oct/2008 where hood `0105050100000000` moved from
 * `Pimg2D002.gif` to `Pimg2D026.gif` across a POST to the same CGI.
 *
 * Everything on this page is keyed on the ROUTE id. `NeighborhoodPage` is a
 * bare `<router-view/>` and supplies no place props, so the URL is the only
 * authority available - and it is also the right one. The server still enforces
 * the write; `canEdit` only decides whether an active control is offered.
 *
 * Vue Router reuses THIS page when only `/neighborhood/:id` changes, so
 * `mounted()` does not run again. `hoodId` is watched so every id gets its own
 * authorization and its own name, and the `:key` above ties the selector's
 * lifetime to the id so no option list, pending radio or message can cross into
 * a different neighborhood.
 */
export default Vue.extend({
  name: "NeighborhoodMapBackgroundPage",
  components: { PlaceMapBackgroundSelector },
  data() {
    return {
      checked: false,
      canEdit: false,
      hoodName: "",
    };
  },
  computed: {
    hoodId(): string {
      return this.$route.params.id;
    },
    /**
     * The name is omitted rather than guessed. A wrong name is worse than no
     * name, because the viewer is about to change that neighborhood's map.
     */
    heading(): string {
      return this.hoodName ? `${WIZARD_TITLE} - ${this.hoodName}` : WIZARD_TITLE;
    },
  },
  watch: {
    hoodId(): void {
      this.authorize();
    },
  },
  methods: {
    async checkAdmin(hoodId: string): Promise<boolean> {
      try {
        await this.$http.get(`/hood/${hoodId}/can_admin`);
        return true;
      } catch (error) {
        return false;
      }
    },
    /** Reads the name of one hood. An empty result means "do not name it". */
    async loadHoodName(hoodId: string): Promise<string> {
      try {
        const response = await this.$http.get(`/hood/${hoodId}`);
        return response.data.hood.name;
      } catch (error) {
        return "";
      }
    },
    /**
     * Prepares the step for the id currently in the URL, and reveals it only
     * once that id is authorized and named.
     *
     * Everything the previous neighborhood produced is dropped first: `checked`
     * hides the step so no selector and no heading are on screen while the
     * answers are outstanding, `hoodName` drops the old name so it cannot be
     * read as the new one's, and `canEdit` withdraws the write authority so an
     * authorized neighborhood can never lend its authority to the next one.
     *
     * Each reply is applied only if the URL still holds the id it was asked
     * for. Without that, a slow answer for the neighborhood the viewer just
     * left could unlock, rename, or redirect away from the one now in the URL.
     */
    async authorize(): Promise<void> {
      const hoodId = this.hoodId;
      this.checked = false;
      this.canEdit = false;
      this.hoodName = "";
      document.title = "Background - Cybertown";
      const canEdit = await this.checkAdmin(hoodId);
      if (this.hoodId !== hoodId) {
        return;
      }
      if (!canEdit) {
        this.$router.push("/restricted");
        return;
      }
      const hoodName = await this.loadHoodName(hoodId);
      if (this.hoodId !== hoodId) {
        return;
      }
      this.hoodName = hoodName;
      this.canEdit = true;
      this.checked = true;
      document.title = hoodName
        ? `${hoodName} Background - Cybertown`
        : "Background - Cybertown";
    },
  },
  async mounted(): Promise<void> {
    await this.authorize();
  },
});
</script>
