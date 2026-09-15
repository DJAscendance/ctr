<template>
  <div class="flex-1 text-center text-lg" v-if="accessLevel">
    <div class="flex-1">
      <div class="m-5" v-if="accessLevel.includes('security')">
        <div class="flex p-2 font-bold text-3xl">Overview</div>
        <hr />
        <CommunityData class="text-left p-2" :accessLevel="accessLevel"></CommunityData>
      </div>
    </div>
  </div>
  <div v-else>
    <div class="text-5xl p-5">Access Denied</div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import CommunityData from './panels/data.vue';
export default defineComponent({
  components: { CommunityData },
  name: "overview",
  data: () => {
    return {
    };
  },
  props: [
    "accessLevel",
  ],
  methods: {
  },
  created() {
  },
  mounted() {
  },
});
</script>
