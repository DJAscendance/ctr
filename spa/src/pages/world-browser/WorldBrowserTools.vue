<template>
  <div>

    <button class="btn-ui"
            v-on:click="opener('#/information/'
              + $store.data.place.type
              + '/'
              + $store.data.place.id
              + '/'
              + $store.data.place.slug)">Information</button>
    <span v-if="$store.data.place.slug === 'employment'">
      <button class="btn-ui"
              v-on:click="opener('#/messageboard/' + $store.data.place.id)">Job Offers</button>
    </span>
    <span v-else-if="$store.data.place.type === 'shop'">
      <button class="btn-ui" v-on:click="opener(`#/inbox/${mallId.data.place.id}`)">
        Mall Inbox
      </button>
      <button class="btn-ui" v-on:click="opener(`#/messageboard/${mallId.data.place.id}`)">
        Mall Messages
      </button>
    </span>
    <span v-else>
    <button class="btn-ui"
            v-on:click="opener('#/inbox/' + $store.data.place.id)">Inbox</button>
    <button class="btn-ui"
            v-on:click="opener('#/messageboard/' + $store.data.place.id)">Messages</button>
    </span>
    <br />
    <div v-if="$store.data.place.slug === 'mall'">
      <button class="btn-ui" v-on:click="opener('#/mall/catalog')">Mall Catalog</button>
      <br />
      <router-link 
      :to="{ name: 'mall-upload' }"
      class="btn-ui">Upload</router-link>
      <button class="btn-ui" v-on:click="opener('#/creator/stocked')">My Uploads</button>
      <br />
    </div>
    <div v-if="canAdmin">
      <!--
        The tool bar keeps every button it had, in the order it had them. These
        are PERMANENT actions and they live here, not inside the Update hub:
        blaxxun CS 4.0 templates/community/action.tmpl:48-56 put Group Message
        under #ifdef owneraccess and Access Rights under #ifdef rightsaccess, both
        on the bar. For a colony, Update now opens the scoped hub instead of being
        a dead <span>, and that hub deliberately carries neither Message to All,
        Inbox to All nor Access Rights - it would be the same action in two
        places. Other place types have no scoped hub and are untouched.
      -->
      <span v-if="$store.data.place.type === 'colony'">
        <router-link v-if="can('message_to_all')"
                     :to="{ name: 'colonyMessageToAll' }"
                     class="btn-ui">Message to All</router-link>
        <router-link v-if="can('inbox_to_all')"
                     :to="{ name: 'colonyInboxToAll'}"
                     class="btn-ui">Inbox to All</router-link>
      </span>
      <router-link
        v-if="$store.data.place.type === 'colony' && canOpen"
        :to="{ name: 'colonyUpdate' }"
        class="btn-ui"
      >Update</router-link>
      <span v-else-if="$store.data.place.type !== 'colony'" class="btn-ui">Update</span>
      <span v-show="$store.data.place.type !== 'shop' && $store.data.place.slug !== 'cityhall'">
        <!--
          A colony's Access Rights button follows the capability that actually
          governs the POST. ColonyService.canManageAccess admits the Colony
          Leader but not the Colony Deputy, so a Deputy no longer sees a button
          whose submission would have been refused.
        -->
        <router-link v-if="$store.data.place.type !== 'colony' || can('manage_access_rights')"
                     :to="{ name: 'worldAccessRights' }"
                     class="btn-ui">Access Rights</router-link>
      </span>
      <br />
    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

export default Vue.extend({
  name: "WorldBrowserTools",
  data: () => {
    return {
      adminCheck: false,
      loaded: false,
      canAdmin: false,
      hubAvailable: false,
      canOpen: false,
      capabilities: [],
      data: null,
      mallId: null,
    };
  },
  methods: {
    async getMallId(){
      this.mallId = await this.$http.get('/place/mall');
    },
    /** Whether the server granted this capability at this colony. */
    can(capability) {
      return this.capabilities.indexOf(capability) !== -1;
    },
    /**
     * Which tools this member may use at this colony. 200 means at least one
     * capability was granted; 403 means none. `canOpen` is the server's answer to
     * the narrower question of whether the Update wizard itself has any screen to
     * show. Presentational only - every tool re-checks server-side when used.
     * Only colonies have a scoped hub.
     */
    async checkHub() {
      this.hubAvailable = false;
      this.canOpen = false;
      this.capabilities = [];
      if (this.$store.data.place.type !== "colony") {
        return;
      }
      try {
        const response = await this.$http.get(
          `/place/${this.$store.data.place.id}/update-hub`,
        );
        this.capabilities = response.data.hub.capabilities || [];
        this.canOpen = response.data.hub.canOpen === true;
        this.hubAvailable = true;
      } catch (error) {
        this.capabilities = [];
        this.canOpen = false;
        this.hubAvailable = false;
      }
    },
    async checkAdmin() {
      let endpoint;
      switch (this.$store.data.place.type) {
      case "colony":
        endpoint = `/colony/${this.$store.data.place.id}/can_admin`;
        break;
      case "public":
        endpoint = `/place/can_admin/${this.$store.data.place.slug}`;
        break;
      case "shop":
        endpoint = "/place/can_admin/mall";
        break;
      }
      try {
        const adminCheck = await this.$http.get(endpoint);
        this.canAdmin = adminCheck.data.result;
      } catch (error) {
        this.canAdmin = false;
      }
    },
    async opener(link) {
      window.open(link, "targetWindow", "height=650,width=800,menubar=no,status=no");
    },
  },
  mounted() {
    this.checkAdmin();
    this.checkHub();
    this.getMallId();
  },
  watch: {
    async $route(to, from) {
      console.log("Place Change");
      await this.checkAdmin();
      await this.checkHub();
      this.loaded = true;
    },
  },
});
</script>
