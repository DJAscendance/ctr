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
    <div class="flex items-center" style="gap: 0.25rem;">
      <label for="movement-speed" style="white-space: nowrap;">Walk Speed</label>
      <input
        id="movement-speed"
        type="range"
        :min="speedMin"
        :max="speedMax"
        step="0.1"
        :value="movementSpeed"
        @input="onSpeedInput"
      />
      <input
        id="movement-speed-number"
        type="number"
        aria-label="Walk speed multiplier"
        :min="speedMin"
        :max="speedMax"
        step="0.1"
        style="width: 4em;"
        :value="movementSpeed"
        @change="onSpeedCommit"
      />
      <span style="min-width: 2.5em; display: inline-block;">{{ movementSpeed.toFixed(1) }}x</span>
      <button type="button" class="btn-ui" @click="resetSpeed">Reset</button>
    </div>
    <br />
    <div v-if="$store.data.place.slug === 'mall'">
      <button class="btn-ui" v-on:click="opener('#/mall/catalog')">Mall Catalog</button>
      <br />
      <router-link
      :to="{ name: 'mall-upload' }"
      class="btn-ui">Upload</router-link>
      <button class="btn-ui" v-on:click="opener('#/creator/stocked')">My Uploads</button>
      <br />
      <router-link v-if="isMallStaff"
                   :to="{ name: 'MallPending' }"
                   class="btn-ui">Mall Check</router-link>
      <br v-if="isMallStaff" />
    </div>
    <div v-if="canAdmin">
      <span v-if="this.$store.data.place.type === 'colony'">
        <router-link :to="{ name: 'colonyMessageToAll' }"
                     class="btn-ui">Message to All</router-link>
        <router-link :to="{ name: 'colonyInboxToAll'}"
              class="btn-ui">Inbox to All</router-link>
      </span>
      <span href=""
            class="btn-ui">Update</span>
      <span v-show="$store.data.place.type !== 'shop' && $store.data.place.slug !== 'cityhall'">
        <router-link :to="{ name: 'worldAccessRights' }"
                     class="btn-ui">Access Rights</router-link>
      </span>
      <br />
    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import {
  DEFAULT_MOVEMENT_SPEED_MULTIPLIER,
  formatSpeedInput,
  MAX_MOVEMENT_SPEED_MULTIPLIER,
  MIN_MOVEMENT_SPEED_MULTIPLIER,
} from "@/helpers/movement-speed.helper";

export default Vue.extend({
  name: "WorldBrowserTools",
  data: () => {
    return {
      adminCheck: false,
      loaded: false,
      canAdmin: false,
      isMallStaff: false,
      data: null,
      mallId: null,
      speedMin: MIN_MOVEMENT_SPEED_MULTIPLIER,
      speedMax: MAX_MOVEMENT_SPEED_MULTIPLIER,
    };
  },
  computed: {
    movementSpeed(): number {
      return this.$store.data.movementSpeedMultiplier;
    },
  },
  methods: {
    /*
     * The slider and the number box are two views of ONE value: both hand the
     * raw DOM string to the same store setter, which clamps it (see
     * `clampMovementSpeed`) before it reaches state, storage or the viewer.
     * Neither control keeps a speed of its own, so they cannot disagree.
     */
    onSpeedInput(event: Event): void {
      const target = event.target as HTMLInputElement;
      this.$store.methods.setMovementSpeedMultiplier(target.value);
    },
    /*
     * The number box commits on `change` (Enter, blur, spinner) rather than on
     * `input`, so a half-typed "0." is not clamped up to the minimum under the
     * citizen's fingers. The write-back matters when the clamp lands back on
     * the value already held - "abc" in a box showing 2.5 leaves the store
     * untouched, so Vue has nothing to re-render and the box would stay empty.
     */
    onSpeedCommit(event: Event): void {
      const target = event.target as HTMLInputElement;
      this.$store.methods.setMovementSpeedMultiplier(target.value);
      target.value = formatSpeedInput(this.movementSpeed);
    },
    resetSpeed(): void {
      this.$store.methods.setMovementSpeedMultiplier(DEFAULT_MOVEMENT_SPEED_MULTIPLIER);
    },
    async getMallId(){
      this.mallId = await this.$http.get("/place/mall");
    },
    /**
     * Server-authoritative, mirroring the check the Mall staff pages themselves
     * gate on (`/mall/can_admin`). This is deliberately a different, narrower
     * check than the generic shop `checkAdmin()` above -- it answers "is this
     * member Mall staff", not "can this member administer this specific shop".
     */
    async checkMallStaff() {
      if (this.$store.data.place.slug !== "mall") {
        this.isMallStaff = false;
        return;
      }
      try {
        await this.$http.get("/mall/can_admin");
        this.isMallStaff = true;
      } catch (error) {
        this.isMallStaff = false;
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
    this.checkMallStaff();
    this.getMallId();
  },
  watch: {
    async $route() {
      console.log("Place Change");
      await this.checkAdmin();
      await this.checkMallStaff();
      this.loaded = true;
    },
  },
});
</script>
