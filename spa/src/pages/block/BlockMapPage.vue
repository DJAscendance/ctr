<template>
  <div v-if="loaded">
    <div class="w-full flex-1 text-center">
      <block-lot-map
        :locations="locations"
        :background="mapBackground"
        :aria-label="'Map of ' + block.name"
      >
        <template v-slot:lot="{ lot }">
          <router-link
            v-if="lot && lot.id"
            :to="'/home/' + lot.username"
            :title="lot.name"
            :aria-label="lot.name + ' - home of ' + lot.username"
            class="w-full h-full block text-center flex items-center justify-center"
          >
            <span>
              <img
                v-if="lot.map_icon_index"
                :src="houseIcon(lot.map_icon_index)"
                :alt="lot.name"
              />
            </span>
          </router-link>
          <router-link
            v-else-if="lot && lot.available"
            :to="'/block/' + $route.params.id + '/move/' + lot.location"
            :aria-label="'Free lot ' + lot.location + ' - settle here'"
            class="w-full h-full block text-center flex items-center justify-center"
          >
            <span>
              <img :src="freeImage" alt="Free" />
            </span>
          </router-link>
        </template>
      </block-lot-map>

      <h2>You've landed at {{ this.block.name }}</h2>
      Above is a detailed map of the {{ this.block.name }} block.
      Lots marked as "Free" are available for your new home.

    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

import BlockLotMap from "@/components/block/BlockLotMap.vue";
import {
  blockBackgroundStyle,
  blockFreeIconUrl,
  blockHouseIconUrl,
  colonyDataHelper,
} from "@/helpers";

export default Vue.extend({
  name: "BlockMapPage",
  components: { BlockLotMap },
  props: [
    "block",
    "hood",
    "colony",
  ],
  data: () => {
    return {
      loaded: false,
      locations: [],
    };
  },
  methods: {
    getData(): void {
      this.$http.get("/block/" + this.$route.params.id + "/locations")
      .then((response) => {
        this.locations = response.data.locations;
        document.title = this.block.name + " - Cybertown";
        this.loaded = true;
      });

    },
    houseIcon(index): string {
      return blockHouseIconUrl(this.theme, index);
    },
  },
  computed: {
    theme(): string {
      return colonyDataHelper[this.colony.slug].map_theme;
    },
    mapBackground(): string {
      return blockBackgroundStyle(this.theme, this.block.map_background_index);
    },
    freeImage(): string {
      return blockFreeIconUrl(this.theme);
    },
  },
  mounted() {
    this.getData();
  },
});
</script>
