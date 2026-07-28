<template>
  <!-- p-2 keeps the chooser's text and controls off the window edge; the wizard
       pages it sits on have no wrapper padding of their own. -->
  <div class="text-center p-2">
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
        The candidate background is rendered BEHIND the place's real map content,
        so a leader can see what a candidate puts underneath what is already
        there before committing to it.

        This is an intentional modern enhancement, not a restoration. The original
        Cybertown chooser ({block,neighbor}/wizard/image.tmpl) was a blind list of
        thumbnails with Ok/Cancel and no overlay at all - a leader could not see
        the consequence of a choice until after it was applied. See
        docs/research/classic-place-admin-re-evidence.md section 3.3.

        Both overlays reuse the same renderer their ordinary map page uses, so the
        preview cannot disagree with reality about where anything sits.
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

      <!--
        A neighborhood's map content is its blocks. The preview draws each one in
        its real position with its real name and its real mini-city icon, because
        judging a candidate background means seeing whether it puts a river or a
        dark patch under an existing block - which a bare thumbnail cannot show.

        Block names and icons are rendered here, never edited: creating, renaming,
        moving or re-iconing a block is a separate lane
        (docs/research/classic-place-admin-followups.md).
      -->
      <hood-block-map
        v-else-if="showsBlockOverlay"
        :blocks="blocks"
        :background="previewBackground"
        :theme="theme"
        aria-label="Preview of this neighborhood with the selected background"
      >
        <template v-slot:block="{ block, icon }">
          <span
            v-if="block"
            class="w-full h-full block text-center flex items-center justify-center"
            :style="{ 'background-image': icon }"
            :title="block.name"
          >
            <span>{{ block.name }}</span>
          </span>
        </template>
      </hood-block-map>

      <img
        v-else
        :src="previewUrl"
        :alt="'Preview of the ' + placeTypeLabel + ' map background'"
        :style="previewStyle"
      />

      <p v-if="showsLotOverlay" class="text-sm">
        {{ occupancySummary }}
      </p>
      <p v-if="showsBlockOverlay" class="text-sm">
        {{ blockSummary }}
      </p>
      <p v-if="overlayError" class="text-red-500">{{ overlayError }}</p>

      <p v-if="isDirty" class="text-yellow-500">
        Previewing an unsaved choice. Apply to keep it.
      </p>

      <p v-if="!options.length" class="text-red-500">
        No map background options are currently available for this
        {{ placeTypeLabel }}'s colony.
      </p>

      <fieldset v-else class="mt-2">
        <legend>Choose a background</legend>

        <!--
          One row, paged - not a wall of every option at once.

          The original was a single-file list: {block,neighbor}/wizard/image.tmpl
          emits one radio plus one thumbnail per <br>, i.e. exactly one candidate
          per line, inside a popup that scrolled. With 27 backgrounds in the grass
          theme that is a strip you scroll through, not a grid you scan. A
          flex-wrap grid was the regression; this restores a single row and gives
          it explicit previous/next paging so it works without a scrollbar.
        -->
        <div class="flex flex-row items-center justify-center gap-2 mt-2">
          <button
            type="button"
            class="btn"
            :disabled="busy || !canPageBack"
            @click="pageBack"
            aria-label="Previous backgrounds"
          >
            &lsaquo;
          </button>

          <div class="flex flex-row flex-nowrap justify-center gap-2">
            <label
              v-for="option in visibleOptions"
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

          <button
            type="button"
            class="btn"
            :disabled="busy || !canPageForward"
            @click="pageForward"
            aria-label="More backgrounds"
          >
            &rsaquo;
          </button>
        </div>

        <p class="text-sm mt-1">{{ pageSummary }}</p>
      </fieldset>

      <!--
        Apply / Restore / Cancel, in that order, and in that order in the DOM so
        the visual order and the tab order agree.
      -->
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
          :disabled="busy || selectedIndex === null"
          @click="restoreDefault"
        >
          Restore Default
        </button>
        <button type="button" class="btn" :disabled="busy" @click="cancel">
          Cancel
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
import HoodBlockMap from "@/components/neighborhood/HoodBlockMap.vue";
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

interface HoodBlock {
  location: number;
  id?: number;
  name?: string;
}

/** Candidates shown at once. One row, wide enough for either thumbnail size. */
const PAGE_SIZE = 5;

export default Vue.extend({
  name: "PlaceMapBackgroundSelector",
  components: { BlockLotMap, HoodBlockMap },
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
      overlayError: "",
      unauthorized: false,
      busy: false,
      successMessage: "",
      actionError: "",
      selectedIndex: null as number | null,
      pendingIndex: 0 as number,
      effectiveUrl: "",
      options: [] as MapBackgroundOption[],
      locations: [] as Lot[],
      blocks: [] as HoodBlock[],
      pageStart: 0,
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
    /** Neighborhoods overlay their blocks instead. */
    showsBlockOverlay(): boolean {
      return this.placeType === "hood";
    },
    /**
     * Where Cancel goes: the Update hub this editor was opened from. Named
     * routes, so the hub owns its own path.
     */
    hubRouteName(): string {
      return this.placeType === "block" ? "blockUpdate" : "neighborhoodUpdate";
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
    blockSummary(): string {
      if (!this.blocks.length) {
        return "This neighborhood has no blocks on its map yet.";
      }
      return this.blocks.length === 1
        ? "1 block on this map."
        : `${this.blocks.length} blocks on this map.`;
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
    /** The single row of candidates currently on screen. */
    visibleOptions(): MapBackgroundOption[] {
      return this.options.slice(this.pageStart, this.pageStart + PAGE_SIZE);
    },
    canPageBack(): boolean {
      return this.pageStart > 0;
    },
    canPageForward(): boolean {
      return this.pageStart + PAGE_SIZE < this.options.length;
    },
    pageSummary(): string {
      if (!this.options.length) {
        return "";
      }
      const first = this.pageStart + 1;
      const last = Math.min(this.pageStart + PAGE_SIZE, this.options.length);
      return `Showing ${first}-${last} of ${this.options.length}`;
    },
  },
  methods: {
    houseIcon(index: number): string {
      return blockHouseIconUrl(this.theme, index);
    },
    pageBack(): void {
      this.pageStart = Math.max(0, this.pageStart - PAGE_SIZE);
    },
    pageForward(): void {
      if (this.canPageForward) {
        this.pageStart += PAGE_SIZE;
      }
    },
    /** Scrolls the strip so the given candidate is on the visible page. */
    revealOption(index: number): void {
      const position = this.options.findIndex(option => option.index === index);
      if (position < 0) {
        this.pageStart = 0;
        return;
      }
      this.pageStart = Math.floor(position / PAGE_SIZE) * PAGE_SIZE;
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
        // Open on the page holding what is currently in effect, so the strip
        // starts where the leader already is rather than at the beginning.
        this.revealOption(this.pendingIndex);
      } catch (e) {
        this.loadError =
          (e.response && e.response.data && e.response.data.error) ||
          "Unable to load map background options.";
      } finally {
        this.loading = false;
      }
    },
    /**
     * The map content drawn over the candidate: a block's lots, or a
     * neighborhood's blocks. Read-only and separate from the options fetch - a
     * failure here degrades the preview to "scenery only" rather than blocking
     * the tool, because the background choice itself does not depend on it.
     */
    async loadOverlay(): Promise<void> {
      this.overlayError = "";
      if (this.showsLotOverlay) {
        try {
          const response = await this.$http.get(`${this.apiRoot  }/locations`);
          this.locations = response.data.locations || [];
        } catch (e) {
          this.locations = [];
          this.overlayError =
            "Could not load this block's homes, so the preview shows scenery only.";
        }
        return;
      }
      if (this.showsBlockOverlay) {
        try {
          const response = await this.$http.get(`${this.apiRoot  }/blocks`);
          this.blocks = response.data.blocks || [];
        } catch (e) {
          this.blocks = [];
          this.overlayError =
            "Could not load this neighborhood's blocks, so the preview shows scenery only.";
        }
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
    /**
     * Leaves without changing anything. Nothing was ever persisted by previewing,
     * so this mutates nothing and simply returns to the Update hub this editor
     * was opened from - by name, and unconditionally, so it lands somewhere
     * meaningful even when the editor was reached by a pasted URL with no history
     * behind it. Browser Back is unaffected.
     */
    cancel(): void {
      this.$router.push({
        name: this.hubRouteName,
        params: { id: String(this.placeId) },
      });
    },
    restoreDefault(): void {
      this.submit(null);
    },
  },
  async mounted(): Promise<void> {
    await Promise.all([this.load(), this.loadOverlay()]);
  },
});
</script>
