<template>
  <div >
    <div class="grid grid-cols-5 grid-rows-5">
    <div class="col-span-3 col-start-2 row-start-2 bg-red-800 text-center align-middle">
      <div class="text-4xl text-center m-2">Account Suspended</div>
    </div>
    <div class="
      col-span-3
      col-start-2
      row-start-3
      row-span-3
      text-xl
      border-r-4
      border-b-4
      border-l-4
      border-red-800
    ">
      <div class="m-2">
        <div class="mb-3">
          Dear User,
        </div>
        <div class="mb-3">
          Thank you for your interest in the Revival of Cybertown.
          Unfortunately, our security has determined that you could not
          follow the norms of the community.  These norms are set and agreed
          upon by the members to make sure everyone has a safe and enjoyable
          time while visiting Cybertown Revival.
        </div>
        <div class="underline">
          Ban End Date
        </div>
        <div class="mb-3">
          {{ new Date(enddate)
            .toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              timeZone: "America/New_York",
            }) }}
        </div>
        <div class="underline">
          Reason
        </div>
        <div class="mb-3">
          {{ reason }}
        </div>
        Have a great day!
      </div>
    </div>
  </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";

/**
 * The reason and end date arrive in the history state of the navigation that brought the
 * citizen here (see the session guard in `main.ts`). Router 3 carried them as route params
 * that were not part of the path; Router 4 and 5 drop such params, and the state entry
 * has the same lifetime those params had - present for this visit, gone on a reload.
 */
export default defineComponent({
  name: "BannedNotice",
  computed: {
    reason(): string {
      return (window.history.state && window.history.state.reason) || "";
    },
    enddate(): string {
      return (window.history.state && window.history.state.enddate) || "";
    },
  },
});

</script>
