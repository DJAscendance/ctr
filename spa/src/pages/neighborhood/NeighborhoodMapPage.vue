<template>
	<div class="h-full w-full bg-black flex flex-col" v-if="loaded">
		<div class="w-full flex-1 text-center">
			<div class="inline-block mx-auto">
				<div
					:style="{
						padding: '16px 19px 13px 10px',
						width: '540px',
						height: '300px',
						'background-image': mapBackground
					}"
					class="grid grid-cols-6 gap-0"
				>
					<div v-for="index in 30" :key="index" style="height:53px;">
						<template v-if="blocks.find(b => b.location === index)">
							<router-link
								:to="
									'/block/' +
										blocks.find(b => b.location === index)
											.id
								"
								class="w-full h-full block text-center flex items-center justify-center"
								:style="{
									'background-image': blockBackground
								}"
							>
								<span>{{
									blocks.find(b => b.location === index).name
								}}</span>
							</router-link>
						</template>
					</div>
				</div>
			</div>
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
import { NeighborhoodData } from "./neighborhood-data.interface";
import { colonyDataHelper } from "@/helpers";
import { mapBackgroundOptionsPath } from "@/helpers/map-background.helper";

export default Vue.extend({
  name: "NeighborhoodMapPage",
  components: { Chat },
  data: (): NeighborhoodData => {
    return {
      loaded: false,
      hood: undefined,
      colony: undefined,
      blocks: [],
      // The server-resolved background. Empty until the read returns, so the
      // colony default below covers the loading window and a failed read.
      effectiveUrl: "",
    };
  },
  methods: {
    /**
     * Drops everything on this page that belongs to one neighborhood.
     *
     * Vue Router reuses this component when only `/neighborhood/:id` changes,
     * so nothing is torn down for us. Without this the previous neighborhood's
     * blocks, name and title survive into the next one and the map shows two
     * neighborhoods at once. The title falls back to the same neutral string
     * `main.ts`'s `beforeEach` uses, so it never names the neighborhood the
     * viewer has left.
     */
    clearRouteState(): void {
      this.loaded = false;
      this.hood = undefined;
      this.colony = undefined;
      this.blocks = [];
      this.effectiveUrl = "";
      document.title = "Cybertown";
    },

    /**
     * Reads the neighborhood and its blocks for one specific id.
     *
     * The id is captured by the caller and re-checked on both the success and
     * the failure path. A slow answer for a neighborhood the viewer has already
     * left must not paint over the one now in the URL, and a slow failure for
     * it must not wipe a neighborhood that has already loaded.
     */
    getPlace(hoodId: string): Promise<void> {
      return Promise.all([
        this.$http.get(`/hood/${hoodId}`),
        this.$http.get(`/hood/${hoodId}/blocks`),
      ])
        .then(response => {
          if (this.$route.params.id !== hoodId) {
            return;
          }
          const hood = response[0].data.hood;
          const colony = response[0].data.colony;
          const place = hood;
          place.hood = hood;
          place.colony = colony;

          this.hood = hood;
          this.colony = colony;
          this.blocks = response[1].data.blocks;
          this.$store.methods.setPlace(place);
          document.title = `${hood.name} - Cybertown`;
        })
        .catch(() => {
          if (this.$route.params.id !== hoodId) {
            return;
          }
          // A failed read for the neighborhood now in the URL leaves the page
          // empty rather than showing the previous neighborhood's blocks.
          this.clearRouteState();
        });
    },

    /**
     * The single route-safe load. Everything the public map shows is rebuilt
     * for the id now in the URL: the socket room, the neighborhood, the colony,
     * the blocks, the document title and the map background.
     *
     * Old state is cleared BEFORE the new reads start, so there is no window in
     * which one neighborhood's background sits beside another's blocks.
     */
    async loadRouteHood(): Promise<void> {
      const hoodId = this.$route.params.id;
      await this.unloadPlace();
      this.clearRouteState();
      this.getMapBackground(hoodId);
      await this.getPlace(hoodId);
      if (this.$route.params.id !== hoodId || !this.hood) {
        return;
      }
      this.loaded = true;
      await this.joinPlace();
    },

    async unloadPlace(): Promise<void> {
      if (this.hood) this.$socket.leaveRoom(this.hood.id);
    },
    // The chosen background is whatever MAP-1 reports as effective. The client
    // never derives the index or the filename itself, so a hood that chose
    // index 26 renders index 26 without the SPA knowing what that file is
    // called. This is the read half of MAP-3: it is what makes a saved
    // selection visible on the neighborhood map at all.
    //
    // The id is passed in by the route-safe load and re-checked after the
    // request, on both paths. A slow answer for a neighborhood the viewer has
    // already left must not paint over the one now in the URL, and a slow
    // FAILURE for it must not wipe a background the new neighborhood already
    // loaded.
    getMapBackground(hoodId: string): void {
      this.$http
        .get(mapBackgroundOptionsPath("hood", hoodId))
        .then(response => {
          if (this.$route.params.id !== hoodId) {
            return;
          }
          this.effectiveUrl = response.data.effectiveUrl;
        })
        .catch(() => {
          if (this.$route.params.id !== hoodId) {
            return;
          }
          this.effectiveUrl = "";
        });
    },
    async joinPlace(): Promise<void> {
      await this.$socket.joinRoom(
        this.hood.id,
        this.$store.data.user.token,
      );
    },
  },
  watch: {
    /**
     * Vue Router reuses this page when only `/neighborhood/:id` changes, so
     * `mounted()` does not run again. The whole public map is therefore
     * reloaded here, not just the background: the previous neighborhood's
     * blocks, name, title and socket room go with it.
     */
    "$route.params.id"(): void {
      this.loadRouteHood();
    },
  },
  computed: {
    mapBackground() {
      if (this.effectiveUrl) {
        return `url('${this.effectiveUrl}')`;
      }
      return (
        `url('/assets/img/map_themes/${ 
          colonyDataHelper[this.colony.slug].map_theme 
        }/hood/Pimg2D000.gif')`
      );
    },
    blockBackground() {
      return (
        `url('/assets/img/map_themes/${ 
          colonyDataHelper[this.colony.slug].map_theme 
        }/hood/Picon2D000.gif')`
      );
    },
  },
  mounted() {
    this.loadRouteHood();
  },
  async beforeDestroy() {
    await this.unloadPlace();
  },
});
</script>
