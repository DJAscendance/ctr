<template>
  <div class="h-full w-full bg-black flex flex-col p-2" v-if="loaded">
    <div v-if="!complete">
      <div class="text-center mb-3">
        <h2 class="font-bold text-green">Chat Access Rights</h2>
        <p>
          Here you can decide who is allowed to chat at your home. Leave every field
          blank to let everyone chat. Once you name at least one citizen, only you and
          the citizens listed below may chat here &mdash; everyone else can still visit,
          but will be muted.
        </p>
        <p class="mb-5">
          <strong>Note:</strong>
          <em>Use the button at the bottom to submit the form.</em>
        </p>
      </div>

      <p class="text-center mb-3">
        You can define <strong><font color="#FFFF00">up to 8 citizens</font></strong>
        having <strong><font color="#FFFF00">chat access</font></strong>
      </p>

      <div class="flex gap-1 pb-1 justify-center">
        <div class="flex-none">
          <input class="input-text" size="16" v-model="guest1" />
        </div>
        <div class="flex-none">
          <input class="input-text" size="16" v-model="guest2" />
        </div>
        <div class="flex-none">
          <input class="input-text" size="16" v-model="guest3" />
        </div>
        <div class="flex-none">
          <input class="input-text" size="16" v-model="guest4" />
        </div>
      </div>
      <div class="flex gap-1 justify-center">
        <div class="flex-none">
          <input class="input-text" size="16" v-model="guest5" />
        </div>
        <div class="flex-none">
          <input class="input-text" size="16" v-model="guest6" />
        </div>
        <div class="flex-none">
          <input class="input-text" size="16" v-model="guest7" />
        </div>
        <div class="flex-none">
          <input class="input-text" size="16" v-model="guest8" />
        </div>
      </div>

      <small class="block text-center mt-2">
        <i>
          <u>Note:</u> If a nickname does not exist, it is
          ignored without notification.
        </i>
      </small>

      <div class="text-center mt-3">
        <span v-show="showError" class="text-red-500">{{ error }}</span>
      </div>

      <div class="text-center mt-3">
        <button type="button" class="btn" @click="update">Update</button>
        <button type="button" class="btn" @click="$router.back()">Cancel</button>
      </div>
    </div>
    <div v-if="complete">
      <p class="text-center">
        Your home's chat access rights have been updated.
      </p>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

export default Vue.extend({
  name: "HomeChatAccessPage",
  data: () => {
    return {
      loaded: false,
      showError: false,
      error: "",
      complete: false,
      guest1: "",
      guest2: "",
      guest3: "",
      guest4: "",
      guest5: "",
      guest6: "",
      guest7: "",
      guest8: "",
    };
  },
  methods: {
    async getChatAccess() {
      try {
        const response = await this.$http.get("/home/chat-access");
        const guests = response.data.guests || [];
        this.guest1 = guests[0] || "";
        this.guest2 = guests[1] || "";
        this.guest3 = guests[2] || "";
        this.guest4 = guests[3] || "";
        this.guest5 = guests[4] || "";
        this.guest6 = guests[5] || "";
        this.guest7 = guests[6] || "";
        this.guest8 = guests[7] || "";
        this.loaded = true;
      } catch (e) {
        console.error(e);
      }
    },
    async update() {
      this.showError = false;
      this.error = "";

      try {
        await this.$http.post("/home/chat-access", {
          guests: [
            this.guest1,
            this.guest2,
            this.guest3,
            this.guest4,
            this.guest5,
            this.guest6,
            this.guest7,
            this.guest8,
          ],
        });

        this.complete = true;
      } catch (e) {
        this.error = e.response.data.error;
        this.showError = true;
      }
    },
  },
  mounted() {
    this.getChatAccess();
  },
});
</script>
