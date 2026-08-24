<template>
  <div class="w-full flex">
    <div class="flex flex-col w-full place-items-center">
      <div class="text-red-500" v-show="error">{{ error }}</div>
      <div class="text-center w-full text-5xl mb-1">Mall Pending Objects</div>
      <div class="grid grid-cols-2 w-4/6 justify-items-center">
        <div v-if="totalCount !== 0">
          Sort By:
          <select v-model="orderBy" @change="setLimit">
            <option value="ASC">Oldest First</option>
            <option value="DESC">Newest First</option>
          </select>
        </div>
        <div v-if="totalCount !== 0">
          View Amount:
          <select v-model.number="limit" @change="setLimit">
            <option value="10">10</option>
            <option value="20">20</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </div>
      </div>
      <br />
      <div v-if="totalCount !== 0" class="grid-cols-1 w-4/6 justify-items-center text-center">
        Total Count: {{ totalCount }}
      </div>
      <span v-if="pages.length > 1">Pages</span>
      <div v-if="pages.length > 1" class="flex w-full justify-center font-bold">
        <span class="flex justify-center" v-for="page in pages" :key="page" :value="page">
          <span class="p-2" v-if="pageNum === page">{{ page }}</span>
          <span class="p-2 cursor-pointer"
                style="color:lime;"
                v-else-if="page > (pageNum - 5) && page < (pageNum + 5)"
                @click="setPageNumber(page)">{{ page }}</span>
        </span>
        <span class="p-2 font-bold"
              style="color:lime;"
              v-if="(pageNum + 5) <= pages.length">. . .</span>
      </div>
      <div v-if="totalCount === 0">No items to show</div>
      <div v-else>
        <mall-object-row v-for="object in objects"
                         :key="object.id"
                         :object="object"
                         check-from="pending"
                         :check-query="listQuery">
          <template v-slot:actions>
            <button class="btn-ui" @click="updateName(object.id, object.name)">Edit Name</button>
            <button class="btn-ui" @click="opener(object.directory, object.image)">Image</button>
            <button class="btn-ui"
                    v-show="object.texture"
                    @click="opener(object.directory, object.texture)">Texture</button>
            <button class="btn-ui"
                    @click="opener(object.directory, object.filename)">WRL</button>
            <button class="btn-ui"
                    @click="updateLimit(object.id, object.quantity)">Update Limit</button>
          </template>
          <template v-slot:primary>
            <button class="btn-ui"
                    :disabled="isProcessing"
                    @click="approve(object.id)">Accept</button>
            <button class="btn-ui"
                    :disabled="isProcessing"
                    @click="openReject(object)">Reject</button>
          </template>
        </mall-object-row>
      </div>
      <div class="flex w-full justify-center">
        <div class="flex justify-center">
          <div class="p-1 text-right w-full" v-if="pageNum > 1">
            <button class="btn" @click="back">BACK</button>
          </div>
          <div class="p-1 w-full" v-if="totalCount - offset > limit">
            <button class="btn" @click="next">NEXT</button>
          </div>
        </div>
      </div>
    </div>
      <!--
        Rejecting sends the uploader the reason verbatim, so it is collected in a
        real field rather than a prompt, and validated with the same helper the
        checker uses.
      -->
      <Modal v-if="rejecting">
        <template v-slot:header>
          <button class="btn-ui" :disabled="isProcessing" @click="cancelReject">X</button>
      </template>
      <template v-slot:body>
        <p class="mb-2">Reject "{{ rejecting.name }}" (#{{ rejecting.id }})?</p>
        <label class="block uppercase text-xs opacity-60 mb-1" for="pending-reject-reason">
          Reason for rejection
        </label>
        <textarea id="pending-reject-reason"
                  v-model="rejectReason"
                  class="w-full p-1 mb-2"
                  rows="4"
                  :maxlength="rejectReasonMax"
                  :disabled="isProcessing"
                  placeholder="Tell the uploader what needs fixing."
                  style="background: #001829;"></textarea>
        <p v-if="rejectError" class="text-red-500 mb-2">{{ rejectError }}</p>
        <button class="btn mr-2" :disabled="isProcessing" @click="confirmReject">Reject</button>
        <button class="btn-ui" :disabled="isProcessing" @click="cancelReject">Cancel</button>
      </template>
    </Modal>
  </div>
</template>

<script lang="ts">
import MallObjectRow from "@/components/mall/MallObjectRow.vue";
import Modal from "@/components/modals/Modal.vue";
import mallActions, {
  REJECT_REASON_MAX,
  objectDisplayName,
  rejectReasonError,
} from "./mall-actions.mixin";

export default mallActions.extend({
  name: "MallPending",
  components: { MallObjectRow, Modal },
  data() {
    return {
      objects: [],
      loaded: false,
      totalCount: 0,
      limit: 10,
      offset: 0,
      orderBy: "ASC",
      showNext: true,
      pageNum: 1,
      pages: [],
      column: "status",
      compare: "=",
      content: 2,
      isProcessing: false,
      rejecting: null as any,
      rejectReason: "",
      rejectError: "",
      rejectReasonMax: REJECT_REASON_MAX,
    };
  },
  computed: {
    /**
     * Carried into the checker and back again, so returning from a review lands
     * on the same page and sort the checker was opened from.
     */
    listQuery(): any {
      return { page: this.pageNum, limit: this.limit, order: this.orderBy };
    },
  },
  async mounted(): Promise<void> {
    this.loaded = true;
    this.restoreListState();
    this.isMallStaff();
    this.getResults();
  },
  methods: {
    /** Reads page, limit and sort back out of the URL on load or browser Back. */
    restoreListState(): void {
      const query = this.$route.query;
      const limit = Number.parseInt(String(query.limit || ""), 10);
      const page = Number.parseInt(String(query.page || ""), 10);
      if ([10, 20, 50, 100].indexOf(limit) !== -1) {
        this.limit = limit;
      }
      if (Number.isFinite(page) && page > 0) {
        this.pageNum = page;
      }
      if (query.order === "ASC" || query.order === "DESC") {
        this.orderBy = String(query.order);
      }
      this.offset = (this.pageNum - 1) * this.limit;
    },

    syncListState(): void {
      this.$router.replace({
        path: this.$route.path,
        query: { page: String(this.pageNum), limit: String(this.limit), order: this.orderBy },
      }).catch(() => undefined);
    },

    setLimit() {
      this.offset = 0;
      this.pageNum = 1;
      this.getResults();
    },
    setPageNumber(value) {
      this.pageNum = value;
      this.offset = this.pageNum * this.limit - this.limit;
      this.getResults();
    },
    async getResults(): Promise<void> {
      this.objects = [];
      this.pages = [];
      this.syncListState();
      try {
        const response = await this.$http.get("/mall/all_objects", {
          column: this.column,
          compare: this.compare,
          content: this.content,
          limit: this.limit,
          offset: this.offset,
          orderBy: this.orderBy,
        });
        this.totalCount = response.data.objects.total[0].count;
        this.objects = response.data.objects.objects;
        this.showSuccess = true;
        const pages = Math.ceil(this.totalCount / this.limit);
        for (let i = 1; pages >= i; i++) {
          this.pages.push(i);
        }
      } catch (errorResponse: any) {
        this.reportError(errorResponse);
      }
    },
    async approve(objectId): Promise<void> {
      if (this.isProcessing) return;

      this.showSuccess = false;
      this.showError = false;
      this.isProcessing = true;
      try {
        this.error = "";
        this.showError = false;
        await this.$http.post("/mall/approve", {
          objectId: objectId,
        });
        this.success = "Object Approved";
        this.showSuccess = true;
        this.getResults();
      } catch (errorResponse: any) {
        this.reportError(errorResponse);
      } finally {
        this.isProcessing = false;
      }
    },
    openReject(object): void {
      this.rejecting = object;
      this.rejectReason = "";
      this.rejectError = "";
    },

    cancelReject(): void {
      if (this.isProcessing) return;
      this.rejecting = null;
      this.rejectReason = "";
      this.rejectError = "";
    },

    async confirmReject(): Promise<void> {
      const reason = this.rejectReason.trim();
      const invalid = rejectReasonError(reason);
      if (invalid) {
        this.rejectError = invalid;
        return;
      }
      await this.reject(this.rejecting.id, reason);
    },

    /**
     * Rejection has three outcomes and they are not interchangeable: a failure
     * keeps the modal open with the reason intact so it can be retried, while a
     * success that could not notify is still a completed rejection and closes
     * normally with a warning rather than inviting a second Reject.
     */
    async reject(objectId, reason): Promise<void> {
      if (this.isProcessing) return;

      // Captured before the request, because a success reloads the list and the
      // rejected row is gone by the time the message is shown.
      const rejectedName = objectDisplayName(this.rejecting);

      this.showSuccess = false;
      this.showError = false;
      this.rejectError = "";
      this.isProcessing = true;
      try {
        const response: any = await this.$http.post("/mall/reject", {
          id: objectId,
          reason,
        });
        const data = response && response.data;
        this.success = data && data.notified === false
          ? `${rejectedName} was rejected, but the uploader could not be notified. `
            + "Follow up manually."
          : "Object rejected and the uploader notified.";
        this.showSuccess = true;
        this.rejecting = null;
        this.rejectReason = "";
        this.getResults();
      } catch (errorResponse: any) {
        this.reportError(errorResponse);
        this.rejectError = this.error;
      } finally {
        this.isProcessing = false;
      }
    },
    opener(directory, file) {
      window.open(
        `/assets/object/${directory}/${file}`,
        "targetWindow",
        "width=1000px,height=700px,location=0,menubar=0,status=0,scrollbars=0",
      );
    },
    async next() {
      this.offset = this.pageNum * this.limit;
      this.pageNum++;
      await this.getResults();
    },
    async back() {
      this.pageNum--;
      this.offset = this.pageNum * this.limit - this.limit;
      await this.getResults();
      this.showNext = true;
    },
  },
});
</script>
