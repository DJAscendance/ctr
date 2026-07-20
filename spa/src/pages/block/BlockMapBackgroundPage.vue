<template>
  <div v-if="block">
    <p>
      <strong
        >Map Background for block '{{ block.name }}'</strong
      >
    </p>
    <place-map-background-selector
      :place-id="block.id"
      place-type="block"
    ></place-map-background-selector>
    <p>
      <router-link :to="{ name: 'blockwizard' }">Back to Update Wizard</router-link>
    </p>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import PlaceMapBackgroundSelector from "@/components/PlaceMapBackgroundSelector.vue";

export default Vue.extend({
  name: "BlockMapBackgroundPage",
  components: { PlaceMapBackgroundSelector },
  props: ["block", "hood", "colony"],
  methods: {
    async checkAdmin(): Promise<boolean> {
      try {
        await this.$http.get(`/block/${  this.$route.params.id  }/can_admin`);
        return true;
      } catch (e) {
        return false;
      }
    },
  },
  async mounted(): Promise<void> {
    if (!(await this.checkAdmin())) {
      this.$router.push("/restricted");
      return;
    }
    if (this.block) {
      document.title = `${this.block.name  } Background - Cybertown`;
    }
  },
});
</script>
