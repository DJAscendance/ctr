<template>
  <div class="h-full w-full bg-black flex flex-col p-2" v-if="loaded">
    <template v-if="denied">
      <p class="text-center text-red-500">Insufficient access rights.</p>
      <p class="text-center">
        <button type="button" class="btn" @click="cancel">Back</button>
      </p>
    </template>

    <template v-else-if="complete">
      <p class="text-center">The information for {{ name }} has been updated.</p>
      <p class="text-center">
        <button type="button" class="btn" @click="cancel">Back</button>
      </p>
    </template>

    <template v-else>
      <!--
        The classic editor, restored: a centred "Update the Information for
        <place>" heading over a single plain textarea, with Update and Cancel.
        blaxxun CS 4.0 templates/place/updateinfo.tmpl was exactly that - one
        writable attribute, TXT, in a cols=50 rows=12 textarea. See
        docs/research/classic-place-admin-re-evidence.md section 4.2.

        What is deliberately NOT restored is the original's handling of the value:
        it stored and rendered raw, unfiltered HTML. The server sanitizes this
        submission against the shared allowlist before storing it.
      -->
      <div class="text-center mb-3">
        <p><strong>Update the Information for {{ name }}</strong></p>
      </div>

      <div class="text-center">
        <textarea
          class="input-text"
          cols="50"
          rows="12"
          aria-label="Place information"
          v-model="description"
        ></textarea>
      </div>

      <div class="text-center mt-2">
        <small>
          Basic formatting is allowed - paragraphs, line breaks, bold, italic,
          lists and links. Anything else is removed when the information is saved.
        </small>
      </div>

      <div v-if="error" class="text-center text-red-500 mt-3">{{ error }}</div>

      <div class="text-center mt-3">
        <button
          type="button"
          class="btn"
          :disabled="submitting"
          @click="save"
        >{{ submitting ? 'Updating...' : 'Update' }}</button>
        <button type="button" class="btn" @click="cancel">Cancel</button>
      </div>
    </template>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

export default Vue.extend({
  name: "PlaceUpdateInformationPage",
  data: () => {
    return {
      loaded: false,
      denied: false,
      complete: false,
      submitting: false,
      error: "",
      name: "",
      type: "",
      description: "",
    };
  },
  computed: {
    placeId(): string {
      return this.$route.params.placeId;
    },
  },
  methods: {
    async getData(): Promise<void> {
      try {
        const [information, canEdit] = await Promise.all([
          this.$http.get(`/place/${this.placeId}/information`),
          this.$http.get(`/place/${this.placeId}/information/can_edit`),
        ]);
        this.name = information.data.name;
        // The STORED type, used only to send Cancel back to this place's own
        // Information window. It is not an authorization input.
        this.type = information.data.type || "";
        this.description = information.data.description || "";
        // Presentational only. The update endpoint performs its own check against
        // the stored place type, so this cannot be used to gain access.
        this.denied = canEdit.data.result !== true;
      } catch (e) {
        this.denied = true;
      } finally {
        this.loaded = true;
      }
    },
    async save(): Promise<void> {
      if (this.submitting) return;
      this.submitting = true;
      this.error = "";
      try {
        await this.$http.put(`/place/${this.placeId}/information`, {
          description: this.description,
        });
        this.complete = true;
      } catch (e) {
        if (e.response && e.response.status === 403) {
          this.denied = true;
          return;
        }
        this.error =
          (e.response && e.response.data && e.response.data.error) ||
          "Could not update the information.";
      } finally {
        this.submitting = false;
      }
    },
    /**
     * Returns to the place's own Information window - the screen MANAGE opened
     * this editor from - rather than to whatever is on the history stack. Direct
     * entry and refresh both leave that stack pointing somewhere unrelated.
     *
     * The type comes from the loaded place, so it is the STORED type, not one
     * the URL asserted. `slug` is optional on that route and is not part of the
     * information payload, so it is omitted; the window resolves by id.
     */
    cancel(): void {
      if (this.type) {
        this.$router
          .push({
            name: "information",
            params: { type: this.type, id: String(this.placeId) },
          })
          .catch(() => undefined);
        return;
      }
      this.$router.back();
    },
  },
  mounted(): void {
    this.getData();
  },
});
</script>
