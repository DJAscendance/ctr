<template>
  <!-- p-2: these wizard pages have no wrapper padding of their own, so without
       it the heading and the Back link sit flush against the window edge. -->
  <div class="p-2" v-if="loaded">
    <p>
      <strong>Map Background for neighborhood '{{ hood.name }}'</strong>
    </p>
    <place-map-background-selector
      :place-id="hood.id"
      place-type="hood"
    ></place-map-background-selector>
    <p>
      <router-link :to="{ name: 'neighborhoodpage' }">Back to Neighborhood</router-link>
    </p>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import PlaceMapBackgroundSelector from "@/components/PlaceMapBackgroundSelector.vue";

export default Vue.extend({
  name: "NeighborhoodMapBackgroundPage",
  components: { PlaceMapBackgroundSelector },
  data: () => {
    return {
      loaded: false,
      hood: undefined,
      colony: undefined,
    };
  },
  methods: {
    async checkAdmin(): Promise<boolean> {
      try {
        await this.$http.get(`/hood/${  this.$route.params.id  }/can_admin`);
        return true;
      } catch (e) {
        return false;
      }
    },
    async getData(): Promise<void> {
      const response = await this.$http.get(
        `/hood/${  this.$route.params.id}`,
      );
      this.hood = response.data.hood;
      this.colony = response.data.colony;
      document.title = `${this.hood.name  } Background - Cybertown`;
      this.loaded = true;
    },
  },
  async mounted(): Promise<void> {
    if (!(await this.checkAdmin())) {
      this.$router.push("/restricted");
      return;
    }
    await this.getData();
  },
});
</script>
