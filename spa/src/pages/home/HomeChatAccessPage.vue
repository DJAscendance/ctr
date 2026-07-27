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
        <!--
          Presentation restored from blaxxun Community Server 4.0
          templates/common/updwriterights.tmpl rendered with cht=1, which is the
          tool Cybertown linked as "Chat Access Rights" from the home Update
          Wizard. Archived production URL:

            /cgi-bin/cybertown/edit?ac=read&DTY=I&KTY=ID
              &KEY=h<homeID>&cht=1&TPL=common/updwriterights&PRI=P

          Two things this deliberately does NOT copy from the classic screens.
          The original also exposed a job/role checkbox matrix (the WRO bitmask)
          granting chat write access to whole jobs, and a companion Chat Read
          Access axis. Both are real original capabilities and both are separate
          authorization features; they are deferred, not forgotten. See
          docs/research/classic-place-admin-re-evidence.md sections 2.1 and 2.6.

          The wording below is the chat-specific wording. The broader "full access
          to everything at this place" copy belongs to Owner Access, a different
          axis on a different object, and must never appear here.
        -->
        <div class="text-center mb-3">
          <h2 class="font-bold text-green">
            Update <span class="text-yellow-300">Write Access</span>
            for <span class="text-yellow-300">Chat</span>
          </h2>
          <p>Here you define citizens, who are allowed to chat with you at your home.</p>
          <p>
            If no nickname is defined, everyone is allowed to chat here. You can
            always chat at your own home, so there is no need to add yourself.
            Visitors who are not on the list can still come in and look around -
            they just cannot talk.
          </p>
          <p class="mb-3">
            You can define up to
            <strong class="text-yellow-300">{{ maxGuests }} citizens</strong>
            with <strong class="text-yellow-300">write access</strong>.
          </p>
        </div>

        <!--
          Two rows of four, as the original laid them out. `chat-access-grid`
          collapses to fewer columns on narrow viewports so the tool stays usable
          in a small window without redesigning anything else in CTR.
        -->
        <div class="chat-access-grid" role="group" aria-label="Citizens allowed to chat">
          <div v-for="(guest, index) in guests" :key="index">
            <input
              type="text"
              class="input-text w-full"
              :maxlength="nicknameMaxLength"
              :size="nicknameMaxLength"
              :aria-label="'Citizen ' + (index + 1)"
              :placeholder="'Citizen ' + (index + 1)"
              v-model="guests[index]"
            />
          </div>
        </div>

        <div class="text-center mt-2">
          <small><em>
            <u>Note:</u> If a nickname does not exist, it is ignored without
            notification.
          </em></small>
        </div>

        <div v-if="showError" class="text-center text-red-500 mt-3">{{ error }}</div>

        <div class="text-center mt-3">
          <button
            type="button"
            class="btn"
            :disabled="submitting"
            @click="save"
          >{{ submitting ? 'Updating...' : 'Update' }}</button>
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

<style scoped>
/*
 * Eight fields in two rows of four at CTR's normal desktop width, matching the
 * classic table. Narrower viewports fall back to two columns and then one rather
 * than overflowing - the original was a fixed-width 1999 frame and had no such
 * case to copy.
 */
.chat-access-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.5rem;
  max-width: 40rem;
  margin: 0 auto;
}

@media (max-width: 640px) {
  .chat-access-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 360px) {
  .chat-access-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>

<script lang="ts">
import Vue from "vue";

/** Mirrors HomeService.MAX_CHAT_GUESTS. The server is the boundary. */
const MAX_GUESTS = 8;

/**
 * Mirrors the original's MAXLENGTH=16 on every nickname slot
 * (common/updwriterights.tmpl). This is a display convenience only - the server
 * decides what a valid nickname is, and an unknown one is ignored either way.
 */
const NICKNAME_MAX_LENGTH = 16;

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
      nicknameMaxLength: NICKNAME_MAX_LENGTH,
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
