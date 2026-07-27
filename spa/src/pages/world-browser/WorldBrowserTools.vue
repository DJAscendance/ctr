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
        Colony: the scoped administration tools now live behind one Update entry,
        shown only when the server grants at least one capability at this colony.
        Message to All, Inbox to All and Access Rights are inside that hub.
        Other place types keep the tool bar they had - they have no scoped hub.
      -->
      <router-link
        v-if="$store.data.place.type === 'colony' && hubAvailable"
        :to="{ name: 'colonyUpdate' }"
        class="btn-ui"
      >Update</router-link>
      <span v-else-if="$store.data.place.type !== 'colony'" class="btn-ui">Update</span>
      <span
        v-show="$store.data.place.type !== 'colony'
          && $store.data.place.type !== 'shop'
          && $store.data.place.slug !== 'cityhall'"
      >
        <router-link :to="{ name: 'worldAccessRights' }"
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
      data: null,
      mallId: null,
    };
  },
  methods: {
    async getMallId(){
      this.mallId = await this.$http.get('/place/mall');
    },
    /**
     * Whether this colony offers an Update hub to this member. 200 means the
     * server granted at least one capability; 403 means none, and the entry is
     * not drawn. Presentational only - the hub re-checks on open.
     */
    async checkHub() {
      this.hubAvailable = false;
      if (this.$store.data.place.type !== "colony") {
        return;
      }
      try {
        await this.$http.get(`/place/${this.$store.data.place.id}/update-hub`);
        this.hubAvailable = true;
      } catch (error) {
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
