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
      The tool bar keeps every button it had, in the order it had them. These are
      PERMANENT actions and they live here, not inside the Update hub: blaxxun CS
      4.0 templates/neighbor/action.tmpl:41-44 put Group Message and Update side by
      side on the action bar, with Access Rights beside them under #ifdef
      rightsaccess, and the Update button opened a wizard whose own screens were a
      smaller, different set (`strings neighbor.exe | grep wizard` -> wizardinfo,
      wizardpresent, wizardimage). Duplicating a bar button as a wizard tile would
      put one action in two places; the hub deliberately carries neither Message to
      All, Inbox to All nor Access Rights.

      Each button is drawn from its own capability rather than one broad admin
      flag, so a button is shown only when the server would actually honour it.
      Update follows `canOpen`, which is true only when the hub has something to
      show.
    -->
    <div v-if="hubAvailable && this.$store.data.place.hood">
      <router-link
        v-if="can('message_to_all')"
        :to="{ name: 'neighborhoodMessageToAll' }"
        class="btn-ui"
      >Message to All</router-link>
      <router-link
        v-if="can('inbox_to_all')"
        :to="{ name: 'neighborhoodInboxToAll' }"
        class="btn-ui"
      >Inbox to All</router-link>
      <router-link
        v-if="canOpen"
        :to="{ name: 'neighborhoodUpdate' }"
        class="btn-ui"
      >Update</router-link>
      <router-link
        v-if="can('manage_access_rights')"
        :to="{ name: 'neighborhoodAccessRights' }"
        class="btn-ui"
      >Access Rights</router-link>
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
      canOpen: false,
      capabilities: [],
      loaded: false,
    };
  },
  methods: {
    /** Whether the server granted this capability at this neighborhood. */
    can(capability) {
      return this.capabilities.indexOf(capability) !== -1;
    },
    /**
     * Which tools this member may use at this neighborhood. 200 means at least
     * one capability was granted; 403 means none, and no admin button is drawn.
     * `canOpen` is the server's answer to the narrower question of whether the
     * Update wizard itself has any screen to show.
     * Presentational only - every tool re-checks server-side when used.
     */
    async checkHub() {
      try {
        const response = await this.$http.get(
          `/place/${this.$store.data.place.hood.id}/update-hub`,
        );
        this.capabilities = response.data.hub.capabilities || [];
        this.canOpen = response.data.hub.canOpen === true;
        this.hubAvailable = true;
      } catch (e) {
        this.capabilities = [];
        this.canOpen = false;
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

