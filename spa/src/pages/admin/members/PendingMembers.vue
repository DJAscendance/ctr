<template>
  <div class="flex-1 pt-5" align="center">
    <div class="flex w-full flex-row items-center">
      <div class="flex-1 px-8">
        <h2 class="mb-2">Immigration Approvals</h2>

        <p class="mb-2">
          New citizens waiting for approval, oldest application first. Approving
          one lets them log in and emails them to say so.
        </p>
        <br />

        <p v-if="loading">Loading...</p>
        <p v-else-if="!members.length">No immigrations are waiting.</p>

        <table v-else border="0" cellpadding="6">
          <tr align="center">
            <th align="left">Nickname</th>
            <th align="left">Email</th>
            <th align="left">Applied</th>
            <th></th>
          </tr>
          <tr v-for="member in members" :key="member.id" align="center">
            <td align="left">{{ member.username }}</td>
            <td align="left">{{ member.email }}</td>
            <td align="left">{{ member.created_at | dateFormatFilter }}</td>
            <td>
              <button
                type="button"
                class="btn"
                :disabled="busyId === member.id"
                @click="approve(member)"
              >
                {{ busyId === member.id ? "Approving..." : "Approve" }}
              </button>
            </td>
          </tr>
        </table>
      </div>
    </div>
    <div v-if="showError" class="text-red-500">{{ error }}</div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

/** One immigration waiting on a city administrator. */
interface PendingMember {
  id: number;
  username: string;
  email: string;
  created_at: string;
}

/**
 * The manual half of immigration, for deployments that require approval.
 *
 * There is deliberately no Decline button. Refusing an applicant is already expressed by
 * the existing ban tools, and a banned member drops out of this queue on the server side --
 * a second, parallel notion of "not allowed in" would only be another thing to keep in
 * step with the first.
 */
export default Vue.extend({
  name: "PendingMembers",
  data() {
    return {
      members: [] as PendingMember[],
      loading: true,
      busyId: 0,
      showError: false,
      error: "",
    };
  },
  async mounted(): Promise<void> {
    await this.load();
  },
  methods: {
    async load(): Promise<void> {
      this.loading = true;
      try {
        const { data } = await this.$http.get("/member/pending-approval");
        this.members = data.members || [];
      } catch (errorResponse: any) {
        this.fail(errorResponse);
      } finally {
        this.loading = false;
      }
    },
    async approve(member: PendingMember): Promise<void> {
      this.showError = false;
      this.busyId = member.id;
      try {
        await this.$http.post(`/member/pending-approval/${member.id}/approve`, {});
        // Reloaded from the server rather than spliced out locally, so a queue that two
        // administrators are working at the same time stays honest about what is left.
        await this.load();
      } catch (errorResponse: any) {
        this.fail(errorResponse);
      } finally {
        this.busyId = 0;
      }
    },
    fail(errorResponse: any): void {
      this.error = errorResponse?.response?.data?.error
        || "An unknown error occurred";
      this.showError = true;
    },
  },
});
</script>
