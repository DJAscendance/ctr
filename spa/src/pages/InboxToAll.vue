<template>
  <div class="flex flex-col items-center">
    <div class="text-red-300" v-if="error">
      {{ error }}
    </div>
    <div class="text-green-300" v-if="success">
      {{ success }}
    </div>
    <div>
      <h2>Post a Inbox to All</h2>
    </div>
    <div class="text-sm text-yellow-200 w-5/12 text-center border-black border-4">
      Some HTML coding has been blocked for security reasons.  Basic HTML tags
      (i.e. &lt;p&gt;, &lt;br&gt;, &lt;a href&gt;, and &lt;img src&gt;) are
      allowed.  If a disallowed tag is used, an error message will display.
    </div>
    <div>
      <label for="subject">Subject:</label>&nbsp;&nbsp;
      <input type="text" class="text-black" id="subject" v-model="subject" size="50"/><br><br>
    </div>
    <div>
      <label for="body">Message:</label><br>
    </div>
    <div class="w-2/3 text-center">
      <textarea id="body" class="text-black w-2/3 h-96" v-model="body"></textarea><br><br>
    </div>
    <!--
      Primary action first, Cancel last - the same order every other edit form in
      CTR uses, and the same order in the DOM as on screen so the tab order agrees
      with both. Cancel is type="button" so it can never be taken for a submit.
    -->
    <div>
      <button type="submit" class="btn" @click="postInboxMessage()">POST</button>&nbsp;&nbsp;&nbsp;
      <button type="button" class="btn" @click="switchView()">CANCEL</button>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

import { placeFormReturnTarget } from "@/helpers";

export default Vue.extend({
  name: "InboxToAll",
  data: () => {
    return {
      body: "",
      error: "",
      subject: "",
      success: "",
    };
  },
  methods: {
    async postInboxMessage(): Promise<void> {
      this.error = "";
      if (this.subject === "" || this.body === "") {
        this.error = "A subject and message are required.";
        return;
      }
      try {
        await this.$http.post("/inbox/postinboxall", {
          subject: this.subject,
          body: this.body,
          type: this.$store.data.place.type,
          place_Id: this.$store.data.place.id,
        });
      } catch (error) {
        this.error = error.message;
      } finally {
        this.subject = "";
        this.body = "";
        this.error = "";
        this.success = "Inbox posted successfully.";
      }
    },
    /**
     * Leaves without sending, and mutates nothing.
     *
     * Navigates to the parent place view BY NAME. This route is a named child
     * with an empty path, so its URL is identical to that parent's, and a path
     * push cannot say which of the two it means - vue-router answers with the
     * first empty-path child declared. That is the place view today, so it
     * happened to work; reorder the siblings and the same push resolves back to
     * this form and Cancel silently does nothing. Naming the destination is the
     * only way to tell apart routes that share a path.
     * See helpers/place-form-return.helper.ts.
     */
    switchView(): void {
      const target = placeFormReturnTarget(
        this.$route.name,
        this.$route.params as Record<string, string>,
      );
      this.$router.push(target);
    },
  },
});

</script>
