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
      The tool bar keeps every button it had, in the order it had them. These are
      PERMANENT actions and they live here, not inside the Update hub: blaxxun CS
      4.0 templates/block/action.tmpl put Group Message, Update and Access Rights
      side by side on the action bar, and the Update button opened a wizard whose
      own screens were a smaller, different set (`strings block.exe | grep wizard`
      -> wizardinfo, wizardpresent, wizardimage). Duplicating a bar button as a
      wizard tile would put one action in two places; the hub deliberately carries
      neither Message to All, Inbox to All, Access Rights nor Check Images.

      Each button is drawn from its own capability rather than one broad admin
      flag, so a button is shown only when the server would actually honour it.
      Update follows `canOpen`, which is true only when the hub has something to
      show - a member holding only bar capabilities gets the bar, not an empty
      wizard.
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
      <router-link v-if="canOpen" :to="{ name: 'blockUpdate' }" class="btn-ui">
        Update
      </router-link>
      <!--
        A router-link, like every other destination on this bar. It used to be a
        bare <span> with a click handler, which gave it none of the affordances
        its neighbours have: no pointer cursor or hover state, no tab stop, no
        focus ring, and nothing for a screen reader to announce as a control.
        Being a real link restores all of those from the shared .btn-ui styling
        rather than re-implementing them here.
      -->
      <router-link
        v-if="can('check_images')"
        :to="{ name: 'blockImageCheck' }"
        class="btn-ui"
        title="Check Images"
      >Check</router-link>
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
      canOpen: false,
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
     * `canOpen` is the server's answer to the narrower question of whether the
     * Update wizard itself has any screen to show.
     * Presentational only - every tool re-checks server-side when used.
     */
    async checkHub() {
      try {
        const response = await this.$http.get(
          `/place/${this.$store.data.place.block.id}/update-hub`,
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

