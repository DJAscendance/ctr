<template>
	<div class="text-center" v-if="loaded">
	<button class="btn-ui"
            v-on:click="opener('#/information/'
     +$store.data.place.type
     +'/'
     +$store.data.place.id)">Information</button>
	<button class="btn-ui"
     v-on:click="opener('#/inbox/'+$store.data.place.id)">Inbox</button>
    <button class="btn-ui"
            v-on:click="opener('#/messageboard/'+$store.data.place.id)">Messages</button>
    
		<span href="" class="btn-ui">Vote</span>
		<router-link
			v-if="this.$store.data.place.colony"
			:to="'/place/' + this.$store.data.place.colony.slug"
		>
			<img src="/assets/img/up.gif" />
			{{ this.$store.data.place.colony.name }}
		</router-link>
		<br />
		<br />
    <!--
      One Update entry, drawn only when the server grants at least one capability
      at this neighborhood. Message to All, Inbox to All, Access Rights,
      Information and the map background now live inside the hub rather than as
      separate buttons here. This restores the original shape: blaxxun CS 4.0
      templates/neighbor/action.tmpl:43-44 put a single Update button behind
      #ifdef owneraccess, opening a per-place wizard.
    -->
    <div v-if="hubAvailable && this.$store.data.place.hood">
      <router-link :to="{ name: 'neighborhoodUpdate' }" class="btn-ui">
        Update</router-link>
    </div>
		<br />
	</div>
</template>

<script lang="ts">
import Vue from "vue";

export default Vue.extend({
  name: "NeighborhoodTools",
  data: () => {
    return {
      hubAvailable: false,
      loaded: false,
    };
  },
  methods: {
    /**
     * Whether this neighborhood offers an Update hub to this member. 200 means at
     * least one capability was granted; 403 means none, and no entry is drawn.
     * Presentational only - the hub and every tool inside it re-check server-side.
     */
    async checkHub() {
      try {
        await this.$http.get(
          `/place/${this.$store.data.place.hood.id}/update-hub`,
        );
        this.hubAvailable = true;
      } catch (e) {
        this.hubAvailable = false;
      }
    },
    async opener(link) {
      window.open(link, "targetWindow", "height=650,width=800,menubar=no,status=no");
    },
  },
  watch: {
    "$store.data.place.hood": {
      handler() {
        if (this.$store.data.place.hood) {
          this.loaded = true;
          this.checkHub();
        }
      },
    },
  },
});
</script>

