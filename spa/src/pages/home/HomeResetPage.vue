<template>
  <div class="h-full w-full bg-black flex flex-col p-2" v-if="loaded">
    <div v-if="!complete">
      <template v-if="!hasHome">
        <div class="text-center mb-3">
          <h2>You don't have a home yet.</h2>
          <p>You must first settle into a block before you can reset your home.</p>
        </div>
      </template>
      <template v-else>
        <div class="text-center mb-3">
          <h2 class="font-bold text-green">Reset your Home</h2>
          <p>
            Choose a free lot within <strong>{{ block.name }}</strong> to move to, or
            cancel to keep your home exactly as it is.
          </p>
          <p class="mb-5 text-yellow-200">
            Resetting clears your home's name, description, image and 3D design. Any paid
            3D design is refunded to your wallet.
          </p>
        </div>

        <div class="w-full flex-1 text-center">
          <div class="inline-block mx-auto">
            <div
              :style="{
                width: '480px',
                height: '240px',
                'background-image': mapBackground,
              }"
              class="grid grid-cols-12 gap-0"
            >
              <div v-for="index in 72" :key="index" style="height:40px;">
                <template v-if="locationAt(index)">
                  <!--
                    An occupied lot renders as its owner's map icon and is NOT a button, so
                    a taken lot can never be selected. Only a lot the server reports as
                    available is clickable - and the server re-proves that at claim time,
                    so this is presentation, not the authorization boundary.
                  -->
                  <div
                    v-if="locationAt(index).id"
                    :title="locationAt(index).name"
                    class="w-full h-full block text-center flex items-center justify-center"
                  >
                    <img
                      v-if="locationAt(index).map_icon_index"
                      :src="mapIconImage(locationAt(index).map_icon_index)"
                    />
                  </div>
                  <button
                    v-else-if="locationAt(index).available"
                    type="button"
                    class="w-full h-full text-center flex items-center justify-center"
                    :style="index === selectedLocation ? 'outline: 2px solid yellow;' : ''"
                    @click="selectLocation(index)"
                  >
                    <img :src="freeImage" />
                  </button>
                </template>
              </div>
            </div>
          </div>
        </div>

        <div v-if="showError" class="text-center text-red-500 mt-3">{{ error }}</div>

        <!--
          Two steps on purpose. Reset is destructive and irreversible, so choosing a lot
          only arms it; a second, explicitly-worded confirmation is what actually POSTs.
        -->
        <div v-if="!confirming" class="text-center mt-3">
          <button
            type="button"
            class="btn"
            :disabled="!selectedLocation"
            @click="confirming = true"
          >Reset</button>
          <button type="button" class="btn" @click="$router.back()">Cancel</button>
        </div>

        <div v-else class="text-center mt-3">
          <p class="text-yellow-200 mb-2">
            Reset <strong>{{ homeName }}</strong> and move it to lot
            {{ selectedLocation }} in {{ block.name }}? This cannot be undone.
          </p>
          <button
            type="button"
            class="btn"
            :disabled="submitting"
            @click="reset"
          >{{ submitting ? 'Resetting...' : 'Yes, reset my home' }}</button>
          <button
            type="button"
            class="btn"
            :disabled="submitting"
            @click="confirming = false"
          >No, keep my home</button>
        </div>
      </template>
    </div>
    <div v-if="complete">
      <p class="text-center">
        Your home has been reset.
      </p>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

import { colonyDataHelper } from "@/helpers";

/** Mirrors BlockMapPage: PR #411 lets a block choose its own map background image. */
function mapBackgroundFilename(index: number | null | undefined): string {
  if (!Number.isInteger(index) || (index as number) <= 0) {
    return "Pimg2D000.gif";
  }
  return `Pimg2D${(index as number).toString().padStart(3, "0")}.gif`;
}

export default Vue.extend({
  name: "HomeResetPage",
  data: () => {
    return {
      loaded: false,
      showError: false,
      error: "",
      complete: false,
      submitting: false,
      confirming: false,
      hasHome: false,
      homeName: "",
      block: {} as any,
      colony: {} as any,
      locations: [],
      selectedLocation: null,
    };
  },
  methods: {
    async getData() {
      try {
        const homeResponse = await this.$http.get("/home");
        this.hasHome = !!homeResponse.data.homeData;
        if (this.hasHome) {
          this.homeName = homeResponse.data.homeData.name;
          this.block = homeResponse.data.blockData;

          const [blockResponse, locationsResponse] = await Promise.all([
            this.$http.get(`/block/${this.block.id}`),
            this.$http.get(`/block/${this.block.id}/locations`),
          ]);
          this.colony = blockResponse.data.colony;
          this.locations = locationsResponse.data.locations;
        }
        this.loaded = true;
      } catch (e) {
        console.error(e);
        this.loaded = true;
      }
    },
    locationAt(index) {
      return this.locations.find(location => location.location === index);
    },
    selectLocation(index): void {
      // Changing the target disarms a pending confirmation, so the sentence the citizen
      // confirms always names the lot they are actually about to move to.
      this.selectedLocation = index;
      this.confirming = false;
    },
    mapIconImage(index): string {
      const mapTheme = colonyDataHelper[this.colony.slug].map_theme;
      if (
        (mapTheme === "cyberhood" && index > 5) ||
        (mapTheme === "desert" && index > 7)
      ) {
        return `/assets/img/map_themes/${mapTheme}/block/Picon2D000.gif`;
      }
      return `/assets/img/map_themes/${mapTheme}/block/Picon2D${
        (index - 1).toString().padStart(3, "0")
      }.gif`;
    },
    async reset() {
      if (this.submitting) return;
      this.submitting = true;
      this.showError = false;
      this.error = "";

      try {
        await this.$http.post("/home/reset", {
          blockId: String(this.block.id),
          location: String(this.selectedLocation),
        });

        this.complete = true;
      } catch (e) {
        this.error = e.response?.data?.error || "Could not reset your home.";
        this.showError = true;
        // Drop back to the armed state and refresh the map: the usual reason a reset fails
        // is that someone claimed the lot first, so the stale map must not stay on screen.
        this.confirming = false;
        this.selectedLocation = null;
        await this.getData();
      } finally {
        this.submitting = false;
      }
    },
  },
  computed: {
    mapBackground(): string {
      const theme = colonyDataHelper[this.colony.slug]?.map_theme;
      const defaultUrl = `/assets/img/map_themes/${theme}/block/Pimg2D000.gif`;
      const selectedFilename = mapBackgroundFilename(this.block.map_background_index);
      if (selectedFilename === "Pimg2D000.gif") {
        return `url('${defaultUrl}')`;
      }
      const selectedUrl = `/assets/img/map_themes/${theme}/block/${selectedFilename}`;
      // Layered so a missing/failed selected file falls back to the default underneath it.
      return `url('${selectedUrl}'), url('${defaultUrl}')`;
    },
    freeImage(): string {
      const mapTheme = colonyDataHelper[this.colony.slug]?.map_theme;
      return `/assets/img/map_themes/${mapTheme}/block/Ficon2D000.gif`;
    },
  },
  mounted() {
    this.getData();
  },
});
</script>
