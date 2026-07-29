<template>
  <div class="h-full w-full bg-black flex flex-col p-2" v-if="loaded">
    <!-- archive template: property/updateinfo.tmpl -->
    <div v-if="!complete">
      <template v-if="!hasHome">
        <div class="text-center mb-3">
          <h2>You don't have a home yet.</h2>
          <p>You must first settle into a block before you can update your home.</p>
        </div>
      </template>
      <template v-else>
        <div class="text-center mb-3">
          <h2 class="font-bold text-green">Update your Home Information</h2>
          <p>Here you can change the description shown on your home page.</p>
          <p class="mb-5">
            <strong>Note:</strong>
            <em>Use the button at the bottom to submit the form.</em>
          </p>
        </div>

        <!--
          No `maxlength`. The limit the server enforces is measured on the
          CANONICAL value - the sanitized string it actually stores - and the SPA
          cannot compute that without shipping a second copy of the sanitizer,
          which is precisely what must not happen. A hard cap here would state a
          verdict the client is not able to reach: sanitizing can GROW a value
          (`<br>` becomes `<br />`) so a 3,500-character input can be refused,
          and it can shrink one (a dropped `<script>`) so a longer input can be
          accepted.

          So the counter is a guide, the server is the authority, and its refusal
          is shown through the same error line every other failure uses. What the
          UI must never do is show an input as valid that the server will reject,
          and it no longer does.
        -->
        <div class="text-center">
          <textarea
            class="input-text"
            rows="6"
            cols="60"
            v-model="houseDescription"
          ></textarea>
          <p class="mt-1">{{ houseDescription.length }} / {{ maxLength }}</p>
        </div>

        <div v-if="showError" class="text-center text-red-500 mt-3">{{ error }}</div>

        <div class="text-center mt-3">
          <button type="button" class="btn" @click="update">Update</button>
          <button type="button" class="btn" @click="$router.back()">Cancel</button>
        </div>
      </template>
    </div>
    <div v-if="complete">
      <p class="text-center">
        Your home's information has been updated.
      </p>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

export default Vue.extend({
  name: "HomeUpdateInformationPage",
  data: () => {
    return {
      loaded: false,
      showError: false,
      error: "",
      complete: false,
      hasHome: false,
      houseDescription: "",
      // Mirrors the shared INFORMATION_MAX_LENGTH (api/src/libs/canonical-information).
      // Shown in the counter as a guide only - the server measures the sanitized
      // value, which this side cannot compute, so it is not used as a hard cap.
      // Counted in UTF-16 code units, the same unit the server uses.
      maxLength: 3500,
    };
  },
  methods: {
    async getHome() {
      try {
        const homeResponse = await this.$http.get("/home");
        this.hasHome = !!homeResponse.data.homeData;
        if (this.hasHome) {
          this.houseDescription = homeResponse.data.homeData.information || "";
        }
        this.loaded = true;
      } catch (e) {
        console.error(e);
        this.loaded = true;
      }
    },
    async update() {
      this.showError = false;
      this.error = "";

      try {
        await this.$http.post("/home/update-information", {
          houseDescription: this.houseDescription,
        });

        this.complete = true;
      } catch (e) {
        this.error = e.response?.data?.error || "Could not update your information.";
        this.showError = true;
      }
    },
  },
  mounted() {
    this.getHome();
  },
});
</script>
