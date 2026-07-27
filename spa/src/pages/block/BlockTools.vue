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
    
		<router-link
			v-if="this.$store.data.place.hood"
			:to="'/neighborhood/' + this.$store.data.place.hood.id"
		>
			<img src="/assets/img/up.gif" />
			{{ this.$store.data.place.hood.name }}
		</router-link>
		<br />
		<br />
    <!--
      One Update entry, drawn only when the server grants at least one capability
      at this block. Message to All, Inbox to All, Access Rights, Information, lot
      availability, the map background and Check Images now live inside the hub
      rather than as separate buttons here. This restores the original shape:
      blaxxun CS 4.0 templates/block/action.tmpl:37-41 put a single Update button
      behind #ifdef owneraccess, opening the block wizard. Archived in production
      as block?ac=wizardplace.
    -->
    <div v-if="hubAvailable && this.$store.data.place.block">
      <router-link :to="{ name: 'blockUpdate' }" class="btn-ui">
        Update
      </router-link>
    </div>
		<br />
	</div>
</template>

<script lang="ts">
import Vue from "vue";

export default Vue.extend({
  name: "BlockTools",
  data: () => {
    return {
      hubAvailable: false,
      loaded: false,
    };
  },
  methods: {
    /**
     * Whether this block offers an Update hub to this member. 200 means at least
     * one capability was granted; 403 means none, and no entry is drawn.
     * Presentational only - the hub and every tool inside it re-check server-side.
     */
    async checkHub() {
      try {
        await this.$http.get(
          `/place/${this.$store.data.place.block.id}/update-hub`,
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
  mounted() {
    // BlockPage populates the store asynchronously, so on first mount there may
    // be no block yet; the watcher below runs the check once there is one.
    if (this.$store.data.place.block) {
      this.checkHub();
    }
  },
  watch: {
    "$store.data.place.block": {
      handler() {
        if (this.$store.data.place.block) {
          this.loaded = true;
          this.checkHub();
        }
      },
    },
  },
});
</script>

