<template>
  <div class="h-full w-full bg-black flex flex-col">
    <router-view/>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
  
export default defineComponent({
  name: "NeighborhoodPage",
});
</script>
