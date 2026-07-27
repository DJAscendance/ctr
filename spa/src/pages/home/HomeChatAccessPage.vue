<template>
  <div class="h-full w-full bg-black flex flex-col p-2" v-if="loaded">
    <div v-if="!complete">
      <template v-if="!hasHome">
        <div class="text-center mb-3">
          <h2>You don't have a home yet.</h2>
          <p>You must first settle into a block before you can set chat access.</p>
        </div>
      </template>
      <template v-else>
        <div class="text-center mb-3">
          <h2 class="font-bold text-green">Chat Access Rights</h2>
          <p>
            Choose up to {{ maxGuests }} citizens who may chat at your home.
          </p>
          <p class="mb-5">
            Leave every box empty to let <strong>everyone</strong> chat. You can always chat
            at your own home, so there is no need to add yourself. Visitors who are not on
            the list can still come in and look around - they just cannot talk.
          </p>
        </div>

        <div class="text-center">
          <div v-for="(guest, index) in guests" :key="index" class="mb-2">
            <input
              type="text"
              class="input-text"
              maxlength="32"
              size="20"
              :placeholder="'Citizen ' + (index + 1)"
              v-model="guests[index]"
            />
          </div>
        </div>

        <div v-if="showError" class="text-center text-red-500 mt-3">{{ error }}</div>

        <div class="text-center mt-3">
          <button
            type="button"
            class="btn"
            :disabled="submitting"
            @click="save"
          >{{ submitting ? 'Saving...' : 'Save' }}</button>
          <button type="button" class="btn" @click="$router.back()">Cancel</button>
        </div>
      </template>
    </div>
    <div v-if="complete">
      <p class="text-center">
        Your home's chat access has been updated.
      </p>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

/** Mirrors HomeService.MAX_CHAT_GUESTS. The server is the boundary. */
const MAX_GUESTS = 8;

export default Vue.extend({
  name: "HomeChatAccessPage",
  data: () => {
    return {
      loaded: false,
      showError: false,
      error: "",
      complete: false,
      submitting: false,
      hasHome: false,
      maxGuests: MAX_GUESTS,
      guests: new Array(MAX_GUESTS).fill(""),
    };
  },
  methods: {
    async getData() {
      try {
        const homeResponse = await this.$http.get("/home");
        this.hasHome = !!homeResponse.data.homeData;
        if (this.hasHome) {
          const accessResponse = await this.$http.get("/home/chat-access");
          const configured = accessResponse.data.guests || [];
          // Pad out to a fixed number of boxes so the form shape is stable regardless of
          // how many guests are currently configured.
          this.guests = new Array(MAX_GUESTS)
            .fill("")
            .map((empty, index) => configured[index] || empty);
        }
        this.loaded = true;
      } catch (e) {
        console.error(e);
        this.loaded = true;
      }
    },
    async save() {
      if (this.submitting) return;
      this.submitting = true;
      this.showError = false;
      this.error = "";

      try {
        // Send every box; the server discards blanks and de-duplicates. Sending the whole
        // set is what makes the submission the complete authoritative list.
        await this.$http.post("/home/chat-access", { guests: this.guests });
        this.complete = true;
      } catch (e) {
        this.error = e.response?.data?.error || "Could not update chat access.";
        this.showError = true;
      } finally {
        this.submitting = false;
      }
    },
  },
  mounted() {
    this.getData();
  },
});
</script>
