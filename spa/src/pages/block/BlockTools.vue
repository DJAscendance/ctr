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
      The tool bar keeps every button it had, in the order it had them. Update now
      opens the scoped hub instead of jumping straight to the lot wizard, which is
      the original shape: blaxxun CS 4.0 templates/block/action.tmpl:37-41 put a
      single Update button behind #ifdef owneraccess opening the block wizard,
      archived in production as block?ac=wizardplace. The hub also carries these
      same tools as tiles, so either route reaches them.

      Each button is drawn from its own capability rather than one broad admin
      flag, so a button is shown only when the server would actually honour it.
    -->
    <div v-if="hubAvailable && this.$store.data.place.block">
      <router-link
        v-if="can('message_to_all')"
        :to="{ name: 'blockMessageToAll' }"
        class="btn-ui"
      >Message to All</router-link>
      <router-link
        v-if="can('inbox_to_all')"
        :to="{ name: 'blockInboxToAll' }"
        class="btn-ui"
      >Inbox to All</router-link>
      <router-link :to="{ name: 'blockUpdate' }" class="btn-ui">
        Update
      </router-link>
      <span
        v-if="can('check_images')"
        class="btn-ui"
        title="Check Images"
        v-on:click="opener('#/home/image-check')"
      >Check</span>
      <router-link
        v-if="can('manage_access_rights')"
        :to="{ name: 'blockaccessrights' }"
        class="btn-ui"
      >Access Rights</router-link>
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
      capabilities: [],
      loaded: false,
    };
  },
  methods: {
    /** Whether the server granted this capability at this block. */
    can(capability) {
      return this.capabilities.indexOf(capability) !== -1;
    },
    /**
     * Which tools this member may use at this block. 200 means at least one
     * capability was granted; 403 means none, and no admin button is drawn.
     * Presentational only - every tool re-checks server-side when used.
     */
    async checkHub() {
      try {
        const response = await this.$http.get(
          `/place/${this.$store.data.place.block.id}/update-hub`,
        );
        this.capabilities = response.data.hub.capabilities || [];
        this.hubAvailable = true;
      } catch (e) {
        this.capabilities = [];
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

