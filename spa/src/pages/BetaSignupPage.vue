<template>
  <div class="flex-1 pt-5" align="center">
    <div class="flex w-full flex-row items-center">
      <div class="flex-1 px-8">
        <h2 class="mb-2">Request Beta Access</h2>

        <p class="mb-2">
          Cybertown is in a private beta. Leave your email below and we will
          reach out when you're invited in.
        </p>
        <br />
        <table border="0" v-show="!success">
          <tr align="center">
            <td align="center">Email Address</td>
            <td align="center">
              <input
                v-model="email"
                type="text"
                size="24"
                maxlength="255"
                tabindex="1"
                class="input-text"
                @keyup.exact.enter="register"
              />
            </td>
          </tr>
          <tr align="center">
            <td align="center">Note (optional)</td>
            <td align="center">
              <textarea
                v-model="note"
                rows="3"
                cols="30"
                maxlength="500"
                tabindex="2"
                class="input-text"
              />
            </td>
          </tr>
          <tr aria-hidden="true">
            <td style="display: none">
              <input
                v-model="website"
                type="text"
                tabindex="-1"
                autocomplete="off"
              />
            </td>
          </tr>
          <tr align="center">
            <td align="center" colspan="2">
              <button type="button" tabindex="3" class="btn" @click="register">
                Request Access
              </button>
            </td>
          </tr>
        </table>
        <p v-if="success">
          Thanks! We'll be in touch when your invite is ready.
        </p>
      </div>
    </div>
    <div v-if="showError" class="text-red-500">{{ error }}</div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

export default Vue.extend({
  name: "BetaSignupPage",
  data: () => {
    return {
      email: "",
      note: "",
      website: "",
      showError: false,
      error: "",
      success: false,
    };
  },
  methods: {
    async register(): Promise<void> {
      this.showError = false;
      try {
        if (this.email === "") {
          this.error = "Please enter your email address.";
          this.showError = true;
          return;
        }
        await this.$http.post("/beta-signup", {
          email: this.email,
          note: this.note || undefined,
          website: this.website,
        });
        this.success = true;
      } catch (errorResponse: any) {
        if (errorResponse.response?.data?.error) {
          this.error = errorResponse.response.data.error;
          this.showError = true;
        } else {
          this.error = "An unknown error occurred";
          this.showError = true;
        }
      }
    },
  },
});
</script>
