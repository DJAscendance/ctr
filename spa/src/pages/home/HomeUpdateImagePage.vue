<template>
  <div class="h-full w-full bg-black flex flex-col p-2" v-if="loaded">
    <div v-if="loadError" class="text-center text-red-500 mt-3">{{ loadError }}</div>
    <template v-else>
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
            alt="Your current home image"
            style="max-width: 200px"
          />
        </div>

        <div class="text-center text-yellow mb-3" v-if="imagePending">
          Your image is awaiting review by a Block Leader. You may upload a replacement or
          withdraw it below.
        </div>

        <div class="text-center">
          <input type="file" @change="setFile" accept="image/*" :disabled="busy" />
        </div>

        <div v-if="showError" class="text-center text-red-500 mt-3">{{ error }}</div>
        <div v-if="showRemoved" class="text-center text-green mt-3">Image removed.</div>
        <div v-if="showUploaded" class="text-center text-green mt-3">
          Your image was uploaded and is awaiting review.
        </div>

        <div class="text-center mt-3">
          <button type="button" class="btn" :disabled="busy" @click="upload">Update</button>
          <button type="button" class="btn" :disabled="busy" @click="$router.back()">
            Cancel
          </button>
        </div>
        <div class="text-center mt-3" v-if="currentImage || imagePending">
          <button type="button" class="btn" :disabled="busy" @click="removeImage">
            {{ currentImage ? 'Remove Image' : 'Withdraw Image' }}
          </button>
        </div>
      </template>
    </template>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

export default Vue.extend({
  name: "HomeUpdateImagePage",
  data: () => {
    return {
      loaded: false,
      loadError: "",
      showError: false,
      showRemoved: false,
      showUploaded: false,
      error: "",
      hasHome: false,
      currentImage: null,
      imagePending: false,
      imageFile: null,
      busy: false,
    };
  },
  methods: {
    async getHome() {
      try {
        const homeResponse = await this.$http.get("/home");
        this.hasHome = !!homeResponse.data.homeData;
        if (this.hasHome) {
          this.currentImage = homeResponse.data.homeRecord?.image || null;
          this.imagePending = !!homeResponse.data.homeRecord?.imagePending;
        }
      } catch (e) {
        console.error(e);
        this.loadError = e.response?.data?.error
          || "Could not load your home. Please try again later.";
      } finally {
        this.loaded = true;
      }
    },
    setFile(e) {
      const files = e.target.files || e.dataTransfer.files;
      this.imageFile = files[0] || null;
      // Reset the native input so choosing the same file again still fires change.
      e.target.value = "";
    },
    async upload() {
      if (this.busy) return;
      this.showError = false;
      this.showRemoved = false;
      this.showUploaded = false;
      this.error = "";

      if (!this.imageFile) {
        this.error = "Please choose an image file.";
        this.showError = true;
        return;
      }

      this.busy = true;
      try {
        await this.$http.post("/home/upload-image", {
          imageFile: this.imageFile,
        }, true);

        this.imagePending = true;
        this.imageFile = null;
        this.showUploaded = true;
      } catch (e) {
        this.error = e.response?.data?.error
          || "Could not upload your image. Please try again later.";
        this.showError = true;
      } finally {
        this.busy = false;
      }
    },
    async removeImage() {
      if (this.busy) return;
      this.showError = false;
      this.showRemoved = false;
      this.showUploaded = false;
      this.error = "";

      this.busy = true;
      try {
        await this.$http.post("/home/remove-image");
        this.currentImage = null;
        this.imagePending = false;
        this.imageFile = null;
        this.showRemoved = true;
      } catch (e) {
        this.error = e.response?.data?.error
          || "Could not remove your image. Please try again later.";
        this.showError = true;
      } finally {
        this.busy = false;
      }
    },
  },
  mounted() {
    this.getHome();
  },
});
</script>
