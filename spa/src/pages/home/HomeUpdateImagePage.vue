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
          <h2 class="font-bold text-green">Update your Home Image</h2>
          <p>Upload a personal image to display on your home page.</p>
          <p class="mb-5">
            Any image format is accepted; it will be resized to fit within
            200x200 and converted automatically.
          </p>
        </div>

        <div class="text-center mb-3" v-if="currentImage">
          <img
            :src="'/assets/homes-uploads/' + currentImage"
            style="max-width: 200px"
          />
        </div>

        <div class="text-center">
          <input type="file" @change="setFile" accept="image/*" />
        </div>

        <div v-if="showError" class="text-center text-red-500 mt-3">{{ error }}</div>
        <div v-if="showRemoved" class="text-center text-green mt-3">Image removed.</div>

        <div class="text-center mt-3">
          <button type="button" class="btn" @click="upload">Update</button>
          <button type="button" class="btn" @click="$router.back()">Cancel</button>
        </div>
        <div class="text-center mt-3" v-if="currentImage">
          <button type="button" class="btn" @click="removeImage">Remove Image</button>
        </div>
      </template>
    </div>
    <div v-if="complete">
      <p class="text-center">
        Your home's image has been updated.
      </p>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

export default Vue.extend({
  name: "HomeUpdateImagePage",
  data: () => {
    return {
      loaded: false,
      showError: false,
      showRemoved: false,
      error: "",
      complete: false,
      hasHome: false,
      currentImage: null,
      imageFile: null,
    };
  },
  methods: {
    async getHome() {
      try {
        const homeResponse = await this.$http.get("/home");
        this.hasHome = !!homeResponse.data.homeData;
        if (this.hasHome) {
          this.currentImage = homeResponse.data.homeRecord?.image || null;
        }
        this.loaded = true;
      } catch (e) {
        console.error(e);
      }
    },
    setFile(e) {
      const files = e.target.files || e.dataTransfer.files;
      this.imageFile = files[0];
    },
    async upload() {
      this.showError = false;
      this.error = "";

      if (!this.imageFile) {
        this.error = "Please choose an image file.";
        this.showError = true;
        return;
      }

      try {
        await this.$http.post("/home/upload-image", {
          imageFile: this.imageFile,
        }, true);

        this.complete = true;
      } catch (e) {
        this.error = e.response.data.error;
        this.showError = true;
      }
    },
    async removeImage() {
      this.showError = false;
      this.showRemoved = false;
      this.error = "";

      try {
        await this.$http.post("/home/remove-image");
        this.currentImage = null;
        this.imageFile = null;
        this.showRemoved = true;
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
