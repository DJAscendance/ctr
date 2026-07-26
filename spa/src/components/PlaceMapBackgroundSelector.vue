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
        <strong>Current background</strong>
      </p>
      <img
        :src="effectiveUrl"
        :alt="'Current ' + placeTypeLabel + ' map background'"
        :style="previewStyle"
      />

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
          :disabled="busy || pendingIndex === selectedIndex"
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
      </p>

      <p v-if="successMessage" class="text-green-500">{{ successMessage }}</p>
      <p v-if="actionError" class="text-red-500">{{ actionError }}</p>
    </template>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

interface MapBackgroundOption {
  index: number;
  url: string;
}

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
      validator: (value: string) => ["block", "hood"].includes(value),
    },
  },
  data() {
    return {
      loading: true,
      loadError: "",
      unauthorized: false,
      busy: false,
      successMessage: "",
      actionError: "",
      selectedIndex: null as number | null,
      pendingIndex: 0 as number,
      effectiveUrl: "",
      options: [] as MapBackgroundOption[],
    };
  },
  computed: {
    placeTypeLabel(): string {
      return this.placeType === "block" ? "block" : "neighborhood";
    },
    apiRoot(): string {
      return `/${  this.placeType  }/${  this.placeId}`;
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
    restoreDefault(): void {
      this.submit(null);
    },
  },
  mounted(): void {
    this.load();
  },
});
</script>
