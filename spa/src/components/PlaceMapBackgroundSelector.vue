<template>
  <div class="text-center">
    <p v-if="loading">Loading available backgrounds&hellip;</p>

    <template v-else-if="loadError">
      <p class="text-red-500">{{ loadError }}</p>
    </template>

    <template v-else-if="unauthorized">
      <p class="text-red-500">
        You are not authorized to manage this {{ placeTypeLabel }}'s map
        background.
      </p>
    </template>

    <template v-else>
      <p>
        <strong>{{ previewHeading }}</strong>
      </p>

      <!--
        Blocks get the candidate background rendered BEHIND the live lot overlay,
        so a leader can see whether a candidate puts roads, water or trees under
        an occupied house before committing to it.

        This is an intentional modern enhancement, not a restoration. The original
        Cybertown chooser (blaxxun CS 4.0 block/wizard/image.tmpl) was a blind list
        of 160x80 thumbnails with Ok/Cancel and no overlay at all - a leader could
        not see the consequence of a choice until after it was applied. See
        docs/research/classic-place-admin-re-evidence.md section 3.3.

        The overlay reuses BlockLotMap, the same component the ordinary block map
        and the update wizard render, so the preview cannot disagree with reality
        about where a lot is.
      -->
      <block-lot-map
        v-if="showsLotOverlay"
        :locations="locations"
        :background="previewBackground"
        aria-label="Preview of this block with the selected background"
      >
        <template v-slot:lot="{ lot }">
          <!--
            Deliberately inert: this is a preview, not the settlement map. Free
            lots are shown so their position is visible against the candidate
            scenery, but nothing here navigates or claims a lot.
          -->
          <span
            v-if="lot && lot.id"
            class="w-full h-full block text-center flex items-center justify-center"
            :title="lot.name"
          >
            <img
              v-if="lot.map_icon_index"
              :src="houseIcon(lot.map_icon_index)"
              :alt="lot.name + ' - occupied lot'"
            />
          </span>
          <span
            v-else-if="lot && lot.available"
            class="w-full h-full block text-center flex items-center justify-center"
          >
            <img :src="freeImage" :alt="'Free lot ' + lot.location" />
          </span>
        </template>
      </block-lot-map>

      <!-- Neighborhoods have a different map and no lot occupancy model, so they
           keep the plain preview image. -->
      <img
        v-else
        :src="previewUrl"
        :alt="'Preview of the ' + placeTypeLabel + ' map background'"
        :style="previewStyle"
      />

      <p v-if="showsLotOverlay" class="text-sm">
        {{ occupancySummary }}
      </p>
      <p v-if="lotsError" class="text-red-500">{{ lotsError }}</p>

      <p v-if="isDirty" class="text-yellow-500">
        Previewing an unsaved choice. Apply to keep it.
      </p>

      <p v-if="!options.length" class="text-red-500">
        No map background options are currently available for this
        {{ placeTypeLabel }}'s colony.
      </p>

      <fieldset v-else class="mt-2">
        <legend>Choose a background</legend>
        <div class="flex flex-wrap justify-center gap-2 mt-2">
          <label
            v-for="option in options"
            :key="option.index"
            class="inline-block cursor-pointer"
            :class="{
              'ring-2 ring-green-500': pendingIndex === option.index,
            }"
          >
            <input
              type="radio"
              name="map-background-option"
              :value="option.index"
              v-model.number="pendingIndex"
              :disabled="busy"
            />
            <img
              :src="option.url"
              :alt="'Background option ' + option.index"
              :style="thumbnailStyle"
            />
          </label>
        </div>
      </fieldset>

      <p class="mt-2">
        <button
          type="button"
          class="btn"
          :disabled="busy || !isDirty"
          @click="apply"
        >
          Apply
        </button>
        <button
          type="button"
          class="btn"
          :disabled="busy || !isDirty"
          @click="cancel"
        >
          Cancel
        </button>
        <button
          type="button"
          class="btn"
          :disabled="busy || selectedIndex === null"
          @click="restoreDefault"
        >
          Restore Default
        </button>
      </p>

      <p v-if="successMessage" class="text-green-500">{{ successMessage }}</p>
      <p v-if="actionError" class="text-red-500">{{ actionError }}</p>
    </template>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

import BlockLotMap from "@/components/block/BlockLotMap.vue";
import {
  backgroundStyleFromUrls,
  blockFreeIconUrl,
  blockHouseIconUrl,
  themeFromBackgroundUrl,
} from "@/helpers";

interface MapBackgroundOption {
  index: number;
  url: string;
}

interface Lot {
  location: number;
  id?: number;
  name?: string;
  username?: string;
  available?: boolean;
  map_icon_index?: number;
}

export default Vue.extend({
  name: "PlaceMapBackgroundSelector",
  components: { BlockLotMap },
  props: {
    placeId: {
      type: [Number, String],
      required: true,
    },
    placeType: {
      type: String,
      required: true,
      validator: (value: string) => ["block", "hood"].includes(value),
    },
  },
  data() {
    return {
      loading: true,
      loadError: "",
      lotsError: "",
      unauthorized: false,
      busy: false,
      successMessage: "",
      actionError: "",
      selectedIndex: null as number | null,
      pendingIndex: 0 as number,
      effectiveUrl: "",
      options: [] as MapBackgroundOption[],
      locations: [] as Lot[],
    };
  },
  computed: {
    placeTypeLabel(): string {
      return this.placeType === "block" ? "block" : "neighborhood";
    },
    apiRoot(): string {
      return `/${  this.placeType  }/${  this.placeId}`;
    },
    /** Only blocks have a lot occupancy model to overlay. */
    showsLotOverlay(): boolean {
      return this.placeType === "block";
    },
    /** True while the previewed choice differs from what is stored. */
    isDirty(): boolean {
      return this.pendingIndex !== (this.selectedIndex ?? 0);
    },
    previewHeading(): string {
      return this.isDirty ? "Preview" : "Current background";
    },
    defaultUrl(): string {
      const fallback = this.options.find(option => option.index === 0);
      return fallback ? fallback.url : this.effectiveUrl;
    },
    /** URL of the candidate currently being previewed. */
    previewUrl(): string {
      const pending = this.options.find(
        option => option.index === this.pendingIndex,
      );
      return pending ? pending.url : this.effectiveUrl;
    },
    previewBackground(): string {
      return backgroundStyleFromUrls(this.previewUrl, this.defaultUrl);
    },
    /** Theme is recovered from the server-issued URL rather than guessed. */
    theme(): string {
      return themeFromBackgroundUrl(this.effectiveUrl || this.previewUrl);
    },
    freeImage(): string {
      return blockFreeIconUrl(this.theme);
    },
    occupiedCount(): number {
      return this.locations.filter(lot => !!lot.id).length;
    },
    freeCount(): number {
      return this.locations.filter(lot => !lot.id && lot.available).length;
    },
    occupancySummary(): string {
      if (!this.locations.length) {
        return "This block has no lots opened for settlement yet.";
      }
      const homes = this.occupiedCount === 1 ? "home" : "homes";
      const lots = this.freeCount === 1 ? "lot" : "lots";
      return `${this.occupiedCount} occupied ${homes}, ${this.freeCount} free ${lots}.`;
    },
    previewStyle(): object {
      return this.placeType === "block"
        ? { width: "480px", height: "240px" }
        : { width: "540px", height: "300px" };
    },
    thumbnailStyle(): object {
      const size =
        this.placeType === "block"
          ? { width: "160px", height: "80px" }
          : { width: "180px", height: "100px" };
      return { ...size, objectFit: "cover", display: "block" };
    },
  },
  methods: {
    houseIcon(index: number): string {
      return blockHouseIconUrl(this.theme, index);
    },
    async load(): Promise<void> {
      this.loading = true;
      this.loadError = "";
      try {
        const response = await this.$http.get(
          `${this.apiRoot  }/map-background-options`,
        );
        this.selectedIndex = response.data.selectedIndex;
        this.pendingIndex = response.data.effectiveIndex;
        this.effectiveUrl = response.data.effectiveUrl;
        this.options = response.data.options;
      } catch (e) {
        this.loadError =
          (e.response && e.response.data && e.response.data.error) ||
          "Unable to load map background options.";
      } finally {
        this.loading = false;
      }
    },
    /**
     * Occupancy is a separate, read-only fetch. A failure here degrades the
     * preview to "no overlay information" rather than blocking the tool, because
     * the background choice itself does not depend on it.
     */
    async loadLots(): Promise<void> {
      if (!this.showsLotOverlay) {
        return;
      }
      this.lotsError = "";
      try {
        const response = await this.$http.get(`${this.apiRoot  }/locations`);
        this.locations = response.data.locations || [];
      } catch (e) {
        this.locations = [];
        this.lotsError =
          "Could not load this block's homes, so the preview shows scenery only.";
      }
    },
    async submit(index: number | null): Promise<void> {
      this.busy = true;
      this.successMessage = "";
      this.actionError = "";
      try {
        const response = await this.$http.put(
          `${this.apiRoot  }/map-background-selection`,
          { index },
        );
        this.selectedIndex = response.data.selectedIndex;
        this.pendingIndex = response.data.selectedIndex ?? 0;
        this.successMessage = "Map background updated.";
        await this.load();
      } catch (e) {
        if (e.response && e.response.status === 403) {
          this.unauthorized = true;
        }
        this.actionError =
          (e.response && e.response.data && e.response.data.error) ||
          "Unable to update map background.";
      } finally {
        this.busy = false;
      }
    },
    apply(): void {
      this.submit(this.pendingIndex);
    },
    /** Discards the previewed choice. Nothing was persisted, so this is local. */
    cancel(): void {
      this.pendingIndex = this.selectedIndex ?? 0;
      this.successMessage = "";
      this.actionError = "";
    },
    restoreDefault(): void {
      this.submit(null);
    },
  },
  async mounted(): Promise<void> {
    await Promise.all([this.load(), this.loadLots()]);
  },
});
</script>
