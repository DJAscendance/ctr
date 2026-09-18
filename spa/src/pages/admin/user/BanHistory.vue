<template>
  <div class="grid grid-cols-1 w-8/12 items-center justify-center">
    <div class="text-center" v-if="info.length === 0">
      This user has no bans
    </div>
    <div class="grid grid-cols-1 w-full items-center justify-center" v-else
      v-for="ban in info" :key="ban.id">
      <div class="grid grid-cols-12 border-2 border-white p-1 w-full content-center">
        <div class="text-center col-span-3 font-bold">
          Banned On
        </div>
        <div class="text-center col-span-3 font-bold">
          Ban Ends On
        </div>
        <div class="text-center col-span-3 font-bold">
          Ban Type
        </div>
        <div class="text-center col-span-3 font-bold">
          Banned By
        </div>
        <div class="text-center col-span-3">
          {{ new Date(ban.created_at)
            .toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              timeZone: "America/New_York",
            }) }}
        </div>
        <div class="text-center col-span-3">
          {{ new Date(ban.end_date)
            .toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              timeZone: "America/New_York",
            }) }}
        </div>
        <div class="text-center col-span-3">
          {{ ban.type }}
        </div>
        <div class="text-center col-span-3">
          {{ ban.username }}
        </div>
        <div class="border-t-2 border-gray-700 col-span-12">
          Reason
        </div>
        <div class="col-span-12">
          {{ ban.reason }}
        </div>
        <div class="flex col-span-12 justify-end">
          <button class="btn"
                  @click="openDeleteModal(ban)"
                  v-if="accessLevel.includes('security')">DELETE BAN</button>
        </div>
      </div>
    </div>
    <div v-if="showDeleteModal">
      <div class="fixed inset-0 z-50 flex justify-center items-center">
        <div class="flex flex-col w-1/6 max-w-5xl rounded-lg shadow-lg bg-red-300 text-red-800">
          <!-- header -->
          <div class="p-5">
            <div class="flex justify-between items-start">
              <h3 class="text-2xl font-semibold">Delete Ban</h3>
              <button class="p-1 leading-none" @click="closeDeleteModal">
                <div class="text-xl font-semibold h-6 w-6">
                  <span>x</span>
                </div>
              </button>
            </div>
          </div>
          <!-- body -->
          <div class="p-6">
            <p>Are you sure you want to delete this ban?</p>
            <label class="block mt-3 mb-1" for="delete-ban-reason">
              Reason (required)
            </label>
            <textarea id="delete-ban-reason"
                      class="text-black w-full"
                      v-model="banReason"
                      rows="3"
                      maxlength="255"
                      placeholder="Why is this ban being lifted?"></textarea>
            <div class="text-red-800 font-bold mt-1" v-if="modalError">
              {{ modalError }}
            </div>
          </div>
          <!-- footer -->
          <div class=" p-6 flex justify-end items-center">
            <button class="btn pr-1" @click="closeDeleteModal">Cancel</button>
            <button class="btn" @click="deleteban">Confirm</button>
          </div>
        </div>
      </div>
      <div class="opacity-50 fixed inset-0 z-60 bg-black"></div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
  name: "UserBanHistory",
  data() {
    return {
      info: [],
      success: null,
      showDeleteModal: false,
      banId: 0,
      banReason: "",
      modalError: "",
    };
  },
  props: [
      "accessLevel",
  ],
  methods:{
    async getinfo(): Promise <void>{
      await this.$http.get("/admin/banhistory/", {
        ban_member_id: this.$route.params.id,
      })
        .then((response) => {
          this.info = response.data.banHistory;
        });
    },
    openDeleteModal(ban): void {
      this.banId = ban.id;
      // Deliberately NOT pre-filled with the original ban's reason. That text is
      // the reason the ban was GIVEN, written by whoever issued it; reusing it
      // here would file it in the audit store as this operator's reason for
      // lifting the ban (CTBL-0025, baseline section 11).
      this.banReason = "";
      this.modalError = "";
      this.showDeleteModal = true;
    },
    closeDeleteModal(): void {
      this.showDeleteModal = false;
      this.banReason = "";
      this.modalError = "";
    },
    async deleteban(): Promise<void>{
      const banReason = this.banReason.trim();
      if (!banReason) {
        this.modalError = "Please enter a reason";
        return;
      }
      await this.$http.post("/admin/deleteban/", {
        banId: this.banId,
        banReason: banReason,
      })
        .then(() => {
          this.closeDeleteModal();
          this.success = "Ban Deleted";
          this.getinfo();
        });
    },
  },
  async mounted() {
    if (!this.accessLevel) {
      this.$router.push({ name: "restrictedaccess" });
    }
    await this.getinfo();
  },
});
</script>
