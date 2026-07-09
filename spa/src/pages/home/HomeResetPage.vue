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
            Choose a new free lot within <strong>{{ block.name }}</strong> to move to, or
            cancel to keep your current spot.
          </p>
          <p class="mb-5 text-yellow-200">
            Resetting will clear your home's name, description, image, chat access guest
            list, and 3D design (any paid 3D design will be refunded to your wallet).
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
                <template v-if="locations.find(b => b.location === index)">
                  <div
                    v-if="locations.find(b => b.location === index).id"
                    :title="locations.find(b => b.location === index).name"
                    class="w-full h-full block text-center flex items-center justify-center"
                  >
                    <img
                      v-if="locations.find(b => b.location === index).map_icon_index"
                      :src="mapIconImage(locations.find(b => b.location === index).map_icon_index)"
                    />
                  </div>
                  <button
                    v-else-if="locations.find(b => b.location === index).available"
                    type="button"
                    class="w-full h-full text-center flex items-center justify-center"
                    :style="index === selectedLocation ? 'outline: 2px solid yellow;' : ''"
                    @click="selectedLocation = index"
                  >
                    <img :src="freeImage" />
                  </button>
                </template>
              </div>
            </div>
          </div>
        </div>

        <div v-if="showError" class="text-center text-red-500 mt-3">{{ error }}</div>

        <div class="text-center mt-3">
          <button
            type="button"
            class="btn"
            :disabled="!selectedLocation"
            @click="reset"
          >Reset</button>
          <button type="button" class="btn" @click="$router.back()">Cancel</button>
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

export default Vue.extend({
  name: "HomeResetPage",
  data: () => {
    return {
      loaded: false,
      showError: false,
      error: "",
      complete: false,
      hasHome: false,
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
      }
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
      this.showError = false;
      this.error = "";

      try {
        await this.$http.post("/home/reset", {
          blockId: String(this.block.id),
          location: String(this.selectedLocation),
        });

        this.complete = true;
      } catch (e) {
        this.error = e.response.data.error;
        this.showError = true;
      }
    },
  },
  computed: {
    mapBackground(): string {
      const mapTheme = colonyDataHelper[this.colony.slug]?.map_theme;
      return `url('/assets/img/map_themes/${mapTheme}/block/Pimg2D000.gif')`;
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
