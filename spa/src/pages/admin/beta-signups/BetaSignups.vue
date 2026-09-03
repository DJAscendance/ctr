<template>
  <div class="flex-1">
    <div class="flex w-full justify-center p-5">
      <h1>Beta Signups</h1>
    </div>
    <div class="flex w-full justify-center">
      Total: {{ signups.length }}
    </div>
    <div class="flex w-full justify-center p-5">
      <table>
        <tr>
          <th>Email</th>
          <th>Note</th>
          <th>Date</th>
        </tr>
        <tr class="border" v-for="signup in signups" :key="signup.id">
          <td class="p-5">{{ signup.email }}</td>
          <td class="p-5">{{ signup.note }}</td>
          <td class="p-5 text-center">{{ new Date(signup.created_at).toLocaleTimeString("en-US", {
            month: 'numeric',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            timeZone: 'America/New_York',}) }}
          </td>
        </tr>
      </table>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
export default Vue.extend({
  name: "BetaSignups",
  data: () => {
    return {
      accessLevel: null,
      signups: [],
    };
  },
  methods: {
    async getAdminLevel(): Promise<void> {
      try {
        const access = await this.$http.get("/member/getadminlevel");
        this.accessLevel = access.data.accessLevel;
        this.accessCheck();
      } catch (e) {
        console.log(e);
      }
    },
    accessCheck() {
      if (!this.accessLevel.includes("security")) {
        this.$router.push({ name: "restrictedaccess" });
      }
    },
    async getSignups(): Promise<void> {
      const result = await this.$http.get("/beta-signup");
      this.signups = result.data.signups;
    },
  },
  created() {
    this.getAdminLevel();
  },
  mounted() {
    this.getSignups();
  },
});
</script>
