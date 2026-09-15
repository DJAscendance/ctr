<template>
  <div>Logging out...</div>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
  name: "LogoutPage",
  data: () => {
    return {};
  },
  mounted() {
    this.$store.methods.destroySession();
    this.$router.push({ path: "/login" });
  },
});
</script>
