<template>
<div>
  City Time {{ this.time }}
</div>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
  name: "ClockPage",
  data() {
    return {
      interval: null,
      time: "00:00 --",
      loaded: false,
    };
  },
  beforeUnmount() {
    // prevent memory leak
    clearInterval(this.interval);
  },
  created() {
    // update the time every second
    this.interval = setInterval(() => {
      this.time = Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "numeric",
        timeZone: "America/New_York",
      }).format();
    }, 1000);
  },
});
</script>
