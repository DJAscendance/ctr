<template>
  <div class="h-full w-full bg-black flex flex-col p-2" v-if="loaded">
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

        <div class="text-center">
          <textarea
            class="input-text"
            rows="6"
            cols="60"
            maxlength="1000"
            v-model="houseDescription"
          ></textarea>
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
    };
  },
  methods: {
    async getHome() {
      try {
        const homeResponse = await this.$http.get("/home");
        this.hasHome = !!homeResponse.data.homeData;
        if (this.hasHome) {
          this.houseDescription = homeResponse.data.homeData.description || "";
        }
        this.loaded = true;
      } catch (e) {
        console.error(e);
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
        this.error = e.response.data.error;
        this.showError = true;
      }
    },
  },
  mounted() {
    this.getHome();
  },
});
</script>
