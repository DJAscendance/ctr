<template>
	<div v-if="loaded">
		<div class="w-full flex-1 text-center">
			<block-lot-map
				:locations="locations"
				:background="mapBackground"
				:aria-label="'Settlement lots for ' + block.name"
			>
				<template v-slot:lot="{ location, lot }">
					<router-link
						v-if="lot && lot.id"
						:to="'/block/' + lot.id"
						:aria-label="lot.name + ' - occupied'"
						class="w-full h-full block text-center flex items-center justify-center"
					>
						<span style="
							padding: 3px;
							max-height: 40px;
							line-height: 13px;
							overflow: hidden;">{{ lot.name }}</span>
					</router-link>
					<input
						v-else
						type="checkbox"
						v-model="availableLocations"
						:value="location"
						:aria-label="'Allow settlement on lot ' + location"
					/>
				</template>
			</block-lot-map>

			<p>
				<strong
					>Update Wizard for block '{{
						this.$store.data.place.block.name
					}}'</strong
				>
			</p>

			<small
				>Checkmark the plots where you want members to settle
				down.</small
			>
			<br />
			<button type="button" @click="update" class="btn">Update</button>
			<br />

			<small>
				Change the
				<router-link :to="{ name: 'blockmapbackground' }"
					>background image</router-link
				>
				for this <strong>block</strong>.
			</small>
		</div>
	</div>
</template>

<script lang="ts">
	import Vue from "vue";

	import BlockLotMap from "@/components/block/BlockLotMap.vue";
	import { blockBackgroundStyle, colonyDataHelper } from "@/helpers";

	export default Vue.extend({
		name: "BlockWizardPage",
		components: { BlockLotMap },
		props: ["block", "hood", "colony"],
		data: () => {
			return {
				loaded: false,
				locations: [],
				availableLocations: []
			};
		},
		methods: {
			async getData(): Promise<void> {
				this.$http
					.get("/block/" + this.$route.params.id + "/locations")
					.then(response => {
						this.locations = response.data.locations;
						this.availableLocations = this.locations
							.filter(location => {
								return location.available;
							})
							.map(loc => {
								return loc.location;
							});

						document.title = this.block.name + " Wizard - Cybertown";
						this.loaded = true;
					});
			},
			update(): void {
				this.$http
					.post("/block/" + this.$route.params.id + "/locations", {
						availableLocations: this.availableLocations
					})
					.then(() => {
						this.$router.push({path: `/block/${this.$store.data.place.block.id}`});
					});
			},
			async checkAdmin(): Promise<boolean> {
				try {
					await this.$http.get(
						"/block/" + this.$store.data.place.block.id + "/can_admin"
					);
					return true;
				} catch (e) {
					return false;
				}
			}
		},
		computed: {
			/**
			 * The block's ACTUAL background, not the theme default. The previous
			 * version hardcoded the default background file, so a leader who had
			 * already chosen a background saw the wizard on the wrong scenery -
			 * exactly the drift the shared renderer exists to prevent. The original
			 * showed the block's own background here too: block/wizard/present.tmpl
			 * renders `<BODY BACKGROUND="...<$imgblock>.gif">`, the block's stored
			 * image.
			 */
			mapBackground(): string {
				return blockBackgroundStyle(
					colonyDataHelper[this.colony.slug].map_theme,
					this.block.map_background_index
				);
			}
		},
		async mounted(): Promise<void> {
			if (!(await this.checkAdmin())) {
				this.$router.push("/restricted");
			} else {
				this.getData();
			}
		}
	});
</script>
