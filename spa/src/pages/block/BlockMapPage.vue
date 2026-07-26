<template>
  <div v-if="loaded">
    <div class="w-full flex-1 text-center">
      <div class="inline-block mx-auto">
        <div :style="{
        width: '480px',
        height: '240px',
        'background-image': mapBackground,
      }"
      class="grid grid-cols-12 gap-0"
      >

          <div v-for="index in 72" :key="index" style="height:40px;">
            <template v-if="locations.find(b => b.location === index)" >
              <router-link
                v-if="locations.find(b => b.location === index).id"
                :to="'/home/' + locations.find(b => b.location === index).username"
                :title="locations.find(b => b.location === index).name"
                class="w-full h-full block text-center flex items-center justify-center">
                <span>
                  <img v-if="locations.find(b => b.location === index).map_icon_index" :src="mapIconImage(locations.find(b => b.location === index).map_icon_index)"/>
                </span>
              </router-link>
              <router-link
                v-else-if="locations.find(b => b.location === index).available"
                :to="'/block/' + $route.params.id + '/move/' + index"
                class="w-full h-full block text-center flex items-center justify-center">
                <span>
                  <img :src="freeImage" />
                </span>
              </router-link>
            </template>
          </div>

        </div>
      </div>
      <h2>You've landed at {{ this.block.name }}</h2>
      Above is a detailed map of the {{ this.block.name }} block.
      Lots marked as "Free" are available for your new home.

    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

import { colonyDataHelper } from '@/helpers';

function mapBackgroundFilename(index: number | null | undefined): string {
  if (!Number.isInteger(index) || (index as number) <= 0) {
    return "Pimg2D000.gif";
  }
  return "Pimg2D" + (index as number).toString().padStart(3, "0") + ".gif";
}

export default Vue.extend({
  name: "BlockMapPage",
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
    mapIconImage (index): string {
      if(
        colonyDataHelper[this.colony.slug].map_theme === 'cyberhood' && index > 5 ||
        colonyDataHelper[this.colony.slug].map_theme === 'desert' && index > 7
      ) {
        return "/assets/img/map_themes/" + colonyDataHelper[this.colony.slug].map_theme +
        "/block/Picon2D000.gif";
      } else {
        return "/assets/img/map_themes/" + colonyDataHelper[this.colony.slug].map_theme +
        "/block/Picon2D"+(index-1).toString().padStart(3,"0")+".gif";
      }
    },
  },
  computed: {
    mapBackground(): string {
      const theme = colonyDataHelper[this.colony.slug].map_theme;
      const defaultUrl = "/assets/img/map_themes/" + theme + "/block/Pimg2D000.gif";
      const selectedFilename = mapBackgroundFilename(this.block.map_background_index);
      if (selectedFilename === "Pimg2D000.gif") {
        return "url('" + defaultUrl + "')";
      }
      const selectedUrl = "/assets/img/map_themes/" + theme + "/block/" + selectedFilename;
      // Layered so a missing/failed selected file falls back to the default underneath it.
      return "url('" + selectedUrl + "'), url('" + defaultUrl + "')";
    },
    freeImage(): string {
      return "/assets/img/map_themes/" + colonyDataHelper[this.colony.slug].map_theme +
        "/block/Ficon2D000.gif";
    },
  },
  mounted() {
    this.getData();
  },
});
</script>
