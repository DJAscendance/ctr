<template>
  <div class="text-center">
    <p v-if="state.status === 'loading'">Loading&hellip;</p>

    <template v-else>
      <p v-if="emptyOptions" class="text-red-500">
        {{ emptyMessage }}
      </p>

      <form v-else-if="state.options.length" @submit.prevent="save">
        <fieldset :disabled="controlsDisabled">
          <legend>
            <strong>{{ prompt }}</strong>
          </legend>
          <div class="flex flex-wrap justify-center gap-2 mt-2">
            <label
              v-for="option in state.options"
              :key="option.index"
              class="inline-block cursor-pointer"
              :class="{ 'ring-2 ring-green-500': state.pendingIndex === option.index }"
            >
              <input
                type="radio"
                name="IM2"
                :value="option.index"
                :checked="state.pendingIndex === option.index"
                :disabled="controlsDisabled"
                @change="choose(option.index)"
              />
              <img
                :src="option.url"
                :alt="altText(option.index)"
                :width="thumbnailWidth"
                :height="thumbnailHeight"
                :style="thumbnailStyle"
              />
            </label>
          </div>
          <p class="mt-2">
            <button type="submit" class="btn" :disabled="!canSave">
              {{ submitLabel }}
            </button>
          </p>
        </fieldset>
      </form>

      <p
        v-if="state.message"
        :class="state.messageKind === 'success' ? 'text-green-500' : 'text-red-500'"
      >
        {{ state.message }}
      </p>
    </template>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

import {
  MAP_BACKGROUND_EMPTY_MESSAGE,
  MAP_BACKGROUND_PROMPT,
  MAP_BACKGROUND_SUBMIT_LABEL,
  MAP_BACKGROUND_THUMBNAIL_HEIGHT,
  MAP_BACKGROUND_THUMBNAIL_WIDTH,
  MapBackgroundPlaceType,
  MapBackgroundState,
  applyEditAuthority,
  applyLoaded,
  applyReadFailure,
  applySaveFailure,
  applySaveSuccess,
  beginSave,
  canSaveMapBackground,
  chooseIndex,
  hasNoMapBackgroundOptions,
  initialMapBackgroundState,
  mapBackgroundAltText,
  mapBackgroundControlsDisabled,
  mapBackgroundOptionsPath,
  mapBackgroundSelectionPath,
  mapBackgroundSelectionPayload,
} from "@/helpers/map-background.helper";

/**
 * The classic background step of the block "Multimedia Wizard".
 *
 * All decisions live in `map-background.helper`; this component only renders
 * the state and forwards the two MAP-1 requests. It never derives a theme, an
 * index pool, or a filename - the server returns every candidate.
 */
export default Vue.extend({
  name: "PlaceMapBackgroundSelector",
  props: {
    placeId: {
      type: [Number, String],
      required: true,
    },
    placeType: {
      type: String,
      required: true,
      validator: (value: string) => ["block", "hood"].indexOf(value) !== -1,
    },
    canEdit: {
      type: Boolean,
      default: false,
    },
  },
  data() {
    return {
      state: initialMapBackgroundState() as MapBackgroundState,
    };
  },
  computed: {
    prompt(): string {
      return MAP_BACKGROUND_PROMPT;
    },
    emptyMessage(): string {
      return MAP_BACKGROUND_EMPTY_MESSAGE;
    },
    submitLabel(): string {
      return MAP_BACKGROUND_SUBMIT_LABEL;
    },
    thumbnailWidth(): number {
      return MAP_BACKGROUND_THUMBNAIL_WIDTH;
    },
    thumbnailHeight(): number {
      return MAP_BACKGROUND_THUMBNAIL_HEIGHT;
    },
    /**
     * The historical 160x80 size must be an inline style: the app stylesheet
     * sizes `img` and would otherwise beat the width/height attributes.
     */
    thumbnailStyle(): Record<string, string> {
      return {
        width: `${MAP_BACKGROUND_THUMBNAIL_WIDTH}px`,
        height: `${MAP_BACKGROUND_THUMBNAIL_HEIGHT}px`,
      };
    },
    canSave(): boolean {
      return canSaveMapBackground(this.state);
    },
    controlsDisabled(): boolean {
      return mapBackgroundControlsDisabled(this.state);
    },
    emptyOptions(): boolean {
      return hasNoMapBackgroundOptions(this.state);
    },
    /** Narrows the validated prop to the union the helper expects. */
    placeKind(): MapBackgroundPlaceType {
      return this.placeType === "hood" ? "hood" : "block";
    },
  },
  watch: {
    canEdit(value: boolean): void {
      this.state = applyEditAuthority(this.state, value);
    },
  },
  methods: {
    altText(index: number): string {
      return mapBackgroundAltText(index);
    },
    choose(index: number): void {
      this.state = chooseIndex(this.state, index);
    },
    async load(): Promise<void> {
      try {
        const response = await this.$http.get(
          mapBackgroundOptionsPath(this.placeKind, this.placeId),
        );
        this.state = applyLoaded(this.state, response.data);
      } catch (error) {
        this.state = applyReadFailure(this.state);
      }
    },
    async save(): Promise<void> {
      const saving = beginSave(this.state);
      if (saving === this.state) {
        return;
      }
      const index = saving.pendingIndex;
      this.state = saving;
      try {
        const response = await this.$http.put(
          mapBackgroundSelectionPath(this.placeKind, this.placeId),
          mapBackgroundSelectionPayload(index),
        );
        this.state = applySaveSuccess(this.state, response.data.selectedIndex);
        await this.reload();
        this.$emit("saved", index);
      } catch (error) {
        const status = error && error.response ? error.response.status : undefined;
        this.state = applySaveFailure(this.state, status);
      }
    },
    /** Re-reads after a save so the effective values come from the server. */
    async reload(): Promise<void> {
      const message = this.state.message;
      const messageKind = this.state.messageKind;
      await this.load();
      this.state = { ...this.state, message, messageKind };
    },
  },
  async mounted(): Promise<void> {
    this.state = applyEditAuthority(this.state, this.canEdit);
    await this.load();
  },
});
</script>
