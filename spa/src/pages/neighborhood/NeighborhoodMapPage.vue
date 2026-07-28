<template>
	<div class="h-full w-full bg-black flex flex-col" v-if="loaded">
		<div class="w-full flex-1 text-center">
			<!--
				Geometry and cell placement now come from the shared HoodBlockMap
				renderer, which the background chooser's preview also uses. The
				markup below is only what a block LOOKS like here - a link into the
				block - so the two surfaces cannot drift apart about where a block
				sits or which icon it carries.
			-->
			<hood-block-map
				:blocks="blocks"
				:background="mapBackground"
				:theme="mapTheme"
				aria-label="Neighborhood map"
			>
				<template v-slot:block="{ block, icon }">
					<router-link
						v-if="block"
						:to="'/block/' + block.id"
						class="w-full h-full block text-center flex items-center justify-center"
						:style="{ 'background-image': icon }"
					>
						<span>{{ block.name }}</span>
					</router-link>
				</template>
			</hood-block-map>
			<br />
			<small
				>Click a block on the Neighborhood map above to go to the
				homes</small
			>
		</div>
		<div class="flex flex-none h-1/3 bg-chat">
			<chat ref="chat" v-if="loaded" :place="hood"></chat>
		</div>
	</div>
</template>

<script lang="ts">
import Vue from "vue";
import Chat from "../../components/Chat.vue";
import HoodBlockMap from "@/components/neighborhood/HoodBlockMap.vue";
import { NeighborhoodData } from "./neighborhood-data.interface";
import { colonyDataHelper, hoodBackgroundStyle } from "@/helpers";

export default Vue.extend({
  name: "NeighborhoodMapPage",
  components: { Chat, HoodBlockMap },
  data: (): NeighborhoodData => {
    return {
      loaded: false,
      hood: undefined,
      colony: undefined,
      blocks: [],
    };
  },
  methods: {
    getPlace(): Promise<void> {
      return Promise.all([
        this.$http.get(`/hood/${  this.$route.params.id}`),
        this.$http.get(`/hood/${  this.$route.params.id  }/blocks`),
      ]).then(response => {
        const place = response[0].data.hood;
        place.hood = response[0].data.hood;
        place.colony = response[0].data.colony;

        this.hood = response[0].data.hood;
        this.colony = response[0].data.colony;
        this.blocks = response[1].data.blocks;
        this.$store.methods.setPlace(place);
        document.title = `${this.hood.name  } - Cybertown`;
      });
    },
    async loadAndJoinPlace(): Promise<void> {
      this.loaded = false;
      await this.getPlace();
      this.loaded = true;

      this.joinPlace();
    },

    async unloadPlace(): Promise<void> {
      if (this.hood) this.$socket.leaveRoom(this.hood.id);
    },
    async joinPlace(): Promise<void> {
      await this.$socket.joinRoom(
        this.hood.id,
        this.$store.data.user.token,
      );
    },
  },
  watch: {},
  computed: {
    mapTheme() {
      return colonyDataHelper[this.colony.slug].map_theme;
    },
    mapBackground() {
      // Layered so a missing/failed selected file falls back to the default
      // underneath it. See @/helpers/hood-map.helper.ts. The theme is looked up
      // here rather than read off the sibling computed: `data` is typed as
      // NeighborhoodData, so computed-to-computed access is not visible to the
      // template type checker.
      const theme = colonyDataHelper[this.colony.slug].map_theme;
      return hoodBackgroundStyle(theme, this.hood.map_background_index);
    },
  },
  mounted() {
    this.loadAndJoinPlace();
  },
  async beforeDestroy() {
    await this.unloadPlace();
  },
});
</script>
