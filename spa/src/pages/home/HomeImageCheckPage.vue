<template>
  <div class="h-full w-full bg-black flex flex-col p-4" v-if="loaded">
    <div class="text-center mb-4">
      <h2 class="font-bold text-green">Check Home Images</h2>
      <p>
        Approve images to make them public, or reject anything unsuitable. Until an image
        is approved, visitors see a "NOT CHECKED!" placeholder in its place.
      </p>
    </div>

    <div v-if="showError" class="text-center text-red-500 mb-3">{{ error }}</div>

    <div v-if="queue.length === 0" class="text-center">
      <p><i>No images are waiting to be checked.</i></p>
    </div>

    <table v-else class="w-full border-double border-4 border-gray-400">
      <tr>
        <th class="border-double border-4 border-gray-400 font-chat p-1">Image</th>
        <th class="border-double border-4 border-gray-400 font-chat p-1">Owner</th>
        <th class="border-double border-4 border-gray-400 font-chat p-1">Home</th>
        <th class="border-double border-4 border-gray-400 font-chat p-1">Block</th>
        <th class="border-double border-4 border-gray-400 font-chat p-1">Action</th>
      </tr>
      <tr v-for="item in queue" :key="item.placeId">
        <td class="border-double border-4 border-gray-400 p-1 text-center">
          <img
            v-if="item.previewUrl"
            :src="item.previewUrl"
            style="max-width: 150px; max-height: 150px;"
          />
          <span v-else><i>preview unavailable</i></span>
        </td>
        <td class="border-double border-4 border-gray-400 p-1 text-center">
          {{ item.ownerUsername }}
        </td>
        <td class="border-double border-4 border-gray-400 p-1 text-center">
          {{ item.homeName }}
        </td>
        <td class="border-double border-4 border-gray-400 p-1 text-center">
          {{ item.blockName }}
        </td>
        <td class="border-double border-4 border-gray-400 p-1 text-center">
          <button
            type="button"
            class="btn"
            :disabled="busy"
            @click="approve(item)"
          >
            Approve
          </button>
          <button
            type="button"
            class="btn"
            :disabled="busy"
            @click="reject(item)"
          >
            Reject
          </button>
        </td>
      </tr>
    </table>

    <div class="text-center mt-4">
      <button type="button" class="btn" @click="fetchQueue">Refresh</button>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
// The shared axios instance carries the request interceptor that attaches the apiToken
// header, so authenticated binary fetches (the private image previews) go through it.
import axios from "axios";

export default Vue.extend({
  name: "HomeImageCheckPage",
  data: () => {
    return {
      loaded: false,
      busy: false,
      showError: false,
      error: "",
      queue: [] as any[],
    };
  },
  methods: {
    async fetchQueue() {
      this.showError = false;
      this.error = "";
      try {
        const response = await this.$http.get("/home/moderation/queue");
        const queue = response.data.queue || [];
        this.revokePreviews();
        // Pending images live in a private directory that is never served publicly, so each
        // one is fetched through the authenticated preview endpoint (which sends the
        // apiToken header) and shown via a temporary object URL.
        await Promise.all(queue.map(async (item) => {
          try {
            const image = await axios.get(`/api${item.imageUrl}`, {
              responseType: "blob",
            });
            item.previewUrl = URL.createObjectURL(image.data);
          } catch (e) {
            item.previewUrl = "";
          }
        }));
        this.queue = queue;
        this.loaded = true;
      } catch (e) {
        this.error = e.response?.data?.error || "Could not load the image queue.";
        this.showError = true;
        this.loaded = true;
      }
    },
    revokePreviews() {
      for (const item of this.queue) {
        if (item.previewUrl) {
          URL.revokeObjectURL(item.previewUrl);
        }
      }
    },
    async approve(item) {
      await this.moderate(`/home/moderation/${item.placeId}/approve`, item.revision);
    },
    async reject(item) {
      await this.moderate(`/home/moderation/${item.placeId}/reject`, item.revision);
    },
    async moderate(url, revision) {
      this.busy = true;
      this.showError = false;
      this.error = "";
      try {
        // Send the exact revision the moderator reviewed so the server acts only on that
        // image; if the owner replaced it since the queue loaded, the server answers 409 and
        // the refresh below shows the new revision to re-check.
        await this.$http.post(url, { revision });
        await this.fetchQueue();
      } catch (e) {
        this.error = e.response?.data?.error || "Action failed.";
        this.showError = true;
        // On a conflict the queue has moved on - reload it so the moderator sees the truth.
        if (e.response?.status === 409) {
          await this.fetchQueue();
        }
      } finally {
        this.busy = false;
      }
    },
  },
  mounted() {
    this.fetchQueue();
  },
  beforeDestroy() {
    this.revokePreviews();
  },
});
</script>
