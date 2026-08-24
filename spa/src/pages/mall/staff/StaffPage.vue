<template>
  <div v-if="!canAdmin" class="w-full flex h-full justify-center">
    <div class="text-red-500">{{ error }}</div>
  </div>
  <div v-else class="w-full flex">
    <div class="flex-col w-56 border-r-2 border-white text-center">
      <br />
      <div class="mb-2">
        <router-link class="btn-ui" :to="{name: 'MallWarehouse'}">Warehouse</router-link>
      </div>
      <div class="mb-2">
        <router-link class="btn-ui" :to="{name: 'MallPending'}">Pending</router-link>
      </div>
      <div class="mb-2">
        <router-link class="btn-ui" :to="{name: 'MallStocked'}">Stocked</router-link>
      </div>
      <div class="mb-2">
        <router-link class="btn-ui" :to="{name: 'MallSoldOut'}">Out of Stock</router-link>
      </div>
      <div class="mb-2">
        <router-link class="btn-ui" :to="{name: 'MallObjectSearch'}">Search</router-link>
      </div>
      <br />
      <!--
        Pending only. The export publishes the submission queue to the Mall's own
        site, so offering it from Stocked or Search would imply it exports what
        that list shows. Kept in this layout rather than moved into pending.vue
        so the dialog, its validation and its save path stay in one place.
      -->
      <div v-if="onPendingList" class="mb-2">
        <button class="btn-ui" @click="openExport">Export Mall Data</button>
      </div>
      <br />
      <div class="mb-2">
        <router-link class="btn-ui" :to="{path: '/place/mall'}">Return to Mall</router-link>
      </div>
    </div>
    <div class="w-11/12 h-full p-1 overflow-y-auto"><router-view /></div>

    <!-- Export Mall Data -->
    <div v-if="showExport"
         class="fixed inset-0 flex items-center justify-center"
         style="background: rgba(0,0,0,0.7); z-index: 50;">
      <div class="border-2 border-white p-4" style="background:#001829; max-width: 34rem;">
        <h3 class="mb-2">Export Mall Data</h3>
        <p class="text-sm mb-2">
          Downloads everything CTR knows about the Mall as one JSON file: every object,
          every store, and the staff-panel view each object belongs to.
        </p>
        <label class="block mb-2">
          <input type="checkbox" v-model="includeDerived" :disabled="exporting" />
          Include WRL-derived metadata (WorldInfo, node counts, file sizes, hashes)
        </label>
        <p v-if="includeDerived" class="text-xs mb-2 opacity-80">
          This reads and decompresses every stored object file, so it takes noticeably
          longer than the plain export.
        </p>
        <div v-if="exportError" class="text-red-500 mb-2">{{ exportError }}</div>
        <div v-if="exporting" class="mb-2">Exporting&hellip;</div>
        <div class="text-right">
          <button class="btn mr-2" :disabled="exporting" @click="closeExport">Cancel</button>
          <button class="btn" :disabled="exporting" @click="runExport">Export</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

export default Vue.extend({
  name: "MallStaffPage",
  data: () => {
    return {
      canAdmin: false,
      showError: false,
      error: "",
      success: "",
      showSuccess: false,
      loaded: false,
      showExport: false,
      includeDerived: false,
      exporting: false,
      exportError: "",
    };
  },
  async mounted(): Promise<void> {
    this.loaded = true;
    this.isMallStaff();
  },
  computed: {
    onPendingList(): boolean {
      return this.$route.name === "MallPending";
    },
  },
  watch: {
    onPendingList(pending: boolean) {
      if (!pending) {
        this.showExport = false;
      }
    },
  },
  methods: {
    async isMallStaff() {
      try {
        await this.$http.get("/mall/can_admin");
        this.canAdmin = true;
      } catch (e) {
        this.error = "Access Denied!";
      }
    },

    openExport() {
      this.exportError = "";
      this.showExport = true;
    },

    closeExport() {
      this.showExport = false;
    },

    /**
     * Downloads the export, but only once it has proved it is complete.
     *
     * The export writes its outcome at the END of the document, so a stream that
     * was cut short has no `result` and will not even parse. Saving anything that
     * fails these checks would put a file on disk that looks like a dataset and
     * is not one, so nothing is written unless `result.status` says complete.
     */
    async runExport(): Promise<void> {
      this.exporting = true;
      this.exportError = "";
      try {
        const response = await this.$http.get("/mall/export", {
          derived: this.includeDerived ? 1 : 0,
        });
        const payload: any = response.data;

        if (typeof payload !== "object" || payload === null || !payload.result) {
          this.exportError = "Export incomplete - the response was cut short. Not saved.";
          return;
        }
        if (payload.result.status !== "complete") {
          const truncation = payload.result.truncation;
          const reason = truncation && truncation.reason ? ` (${truncation.reason})` : "";
          const last = truncation && truncation.lastObjectId
            ? ` Last object reached: #${truncation.lastObjectId}.`
            : "";
          this.exportError =
            `Export ${payload.result.status}${reason}. Not saved.${last}`;
          return;
        }

        this.saveExport(payload, response.headers);
        this.showExport = false;
      } catch (error) {
        this.exportError = "The export could not be completed. Not saved.";
      } finally {
        this.exporting = false;
      }
    },

    saveExport(payload: any, headers: any): void {
      // Serialised compactly, matching what the server streamed. Re-indenting it
      // built a third full copy of the largest string in the app -- the raw
      // response, the parsed object, and then a pretty-printed rebuild of it --
      // for a file that is read by tooling rather than by eye.
      const blob = new Blob([JSON.stringify(payload)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = this.exportFilename(headers);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      // Deferred a tick: some browsers fetch the blob url after the current task
      // ends, and revoking synchronously cancels the download.
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    },

    /**
     * Prefers the name the server already chose.
     *
     * `exportMallData` sends a Content-Disposition whose stamp is precise to the
     * second, so two exports taken minutes apart are distinct files. The local
     * fallback matches that precision rather than the old date-only name, which
     * collided for every export after the first on any given day.
     */
    exportFilename(headers: any): string {
      const disposition = headers && (headers["content-disposition"]
        || headers["Content-Disposition"]);
      const match = /filename="([^"]+)"/.exec(String(disposition || ""));
      if (match && /^[\w.-]+$/.test(match[1])) {
        return match[1];
      }
      const stamp = new Date().toISOString().split(".")[0].replace(/:/g, "");
      return `ctr-mall-export-${stamp}Z.json`;
    },
  },
});
</script>
