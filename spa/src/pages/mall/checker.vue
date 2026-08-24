<template>
  <div class="w-full h-full flex flex-col">
    <div v-if="accessDenied" class="w-full flex h-full justify-center items-center">
      <div class="text-red-500">Access Denied!</div>
    </div>

    <div v-else-if="loadError" class="w-full flex h-full justify-center items-center">
      <div class="text-center">
        <div class="text-red-500 mb-2">{{ loadError }}</div>
        <button class="btn" @click="backToList">Back</button>
      </div>
    </div>

    <template v-else-if="inspection">
      <!-- Identity, moderation state and queue position -->
      <div class="w-full border-b border-white p-2 flex flex-wrap items-center">
        <div class="flex-1 min-w-0">
          <div class="text-2xl truncate">
            <span class="opacity-60">#{{ object.id }}</span>
            {{ object.name }}
            <span class="text-sm border px-2 ml-2">{{ object.statusLabel }}</span>
          </div>
          <div class="text-sm opacity-80">
            by {{ creatorLabel }}
            &middot; {{ object.price }} CC
            &middot; qty {{ object.quantity }}
            &middot; limit {{ limitLabel }}
            &middot; {{ storeLabel }}
            &middot; uploaded {{ formatDate(object.createdAt) }}
          </div>
        </div>
        <div class="text-right">
          <div v-if="queue.ids.length" class="mb-1">
            <button class="btn-ui-inline" :disabled="!previousId" @click="goTo(previousId)">
              &#9664; Prev
            </button>
            <span class="mx-2">{{ queueLabel }}</span>
            <button class="btn-ui-inline" :disabled="!nextId" @click="goTo(nextId)">
              Next &#9654;
            </button>
          </div>
          <div>
            <button class="btn-ui-inline" @click="backToList">
              &#9664; Back to {{ fromLabel }}
            </button>
            <a class="btn-ui-inline" :href="ownUrl" target="_blank" rel="noopener">New tab</a>
          </div>
        </div>
      </div>

      <!-- Inspection panes -->
      <div class="flex-1 flex flex-col lg:flex-row overflow-hidden">
        <div class="lg:w-1/2 flex flex-col border-r border-white" style="min-height: 24rem;">
          <div class="flex-1">
            <object-viewer v-if="object.assets.wrl.url" :object-url="object.assets.wrl.url" />
            <div v-else class="h-full flex items-center justify-center text-red-500">
              This object has no stored WRL file.
            </div>
          </div>
          <div class="border-t border-white p-2 flex items-center">
            <img v-if="object.assets.thumbnail.url"
                 :src="object.assets.thumbnail.url"
                 alt="Object thumbnail"
                 style="max-width:160px;max-height:160px;height:auto;width:auto;" />
            <div v-else class="text-red-500">No thumbnail.</div>
            <div class="text-xs opacity-80 ml-3">Thumbnail as buyers will see it.</div>
          </div>
        </div>

        <div class="lg:w-1/2 overflow-y-auto p-2">
          <!-- Findings first: they are why a checker is looking -->
          <section class="mb-4">
            <h3 class="border-b border-white mb-1">Findings</h3>
            <div v-if="!inspection.findings.length" class="text-green">
              Nothing flagged. Size, position and content still need your eye.
            </div>
            <template v-else>
              <div v-for="group in findingGroups" :key="group.severity" class="mb-2">
                <div class="text-sm font-bold" :class="group.className">{{ group.label }}</div>
                <ul class="list-disc ml-5">
                  <li v-for="(finding, index) in group.findings" :key="index" class="mb-1">
                    {{ finding.message }}
                    <span class="text-xs opacity-60">({{ finding.code }})</span>
                  </li>
                </ul>
              </div>
            </template>
            <div class="text-xs opacity-60 mt-1">
              Advisory only. Nothing here accepts or rejects anything.
            </div>
          </section>

          <!-- WorldInfo, verbatim -->
          <section class="mb-4">
            <h3 class="border-b border-white mb-1">WorldInfo</h3>
            <div v-if="!vrml" class="opacity-60">
              The file could not be read, so there is no WorldInfo to show.
            </div>
            <div v-else-if="!vrml.worldInfo.length" class="text-red-500">
              This object has no WorldInfo node.
            </div>
            <div v-else>
              <div v-for="(node, index) in vrml.worldInfo" :key="index" class="mb-2">
                <div v-if="vrml.worldInfo.length > 1" class="text-xs opacity-60">
                  WorldInfo {{ index + 1 }} of {{ vrml.worldInfo.length }}
                </div>
                <div><span class="opacity-60">title</span> "{{ node.title }}"</div>
                <div v-for="(line, lineIndex) in node.info" :key="lineIndex" class="ml-4">
                  "{{ line }}"
                </div>
              </div>
            </div>
          </section>

          <!-- WorldInfo against the CTR record -->
          <section v-if="comparisons" class="mb-4">
            <h3 class="border-b border-white mb-1">WorldInfo vs CTR record</h3>
            <table class="w-full">
              <tr v-for="comparison in comparisons" :key="comparison.field">
                <td class="align-top pr-2 opacity-60">{{ comparison.field }}</td>
                <td class="align-top pr-2">{{ displayValue(comparison.ctrValue) }}</td>
                <td class="align-top pr-2">{{ displayValue(comparison.worldInfoValue) }}</td>
                <td class="align-top" :class="verdictClass(comparison.verdict)">
                  {{ comparison.verdict }}
                  <div v-if="comparison.note" class="text-xs opacity-60">
                    {{ comparison.note }}
                  </div>
                </td>
              </tr>
            </table>
          </section>

          <!-- File and asset facts -->
          <section class="mb-4">
            <h3 class="border-b border-white mb-1">File and assets</h3>
            <table class="w-full">
              <tr>
                <td class="opacity-60 pr-2">Stored as</td>
                <td>{{ object.assets.wrl.filename }} ({{ encodingLabel }})</td>
              </tr>
              <tr>
                <td class="opacity-60 pr-2">Stored bytes</td>
                <td>{{ formatBytes(source.storedBytes) }}</td>
              </tr>
              <tr>
                <td class="opacity-60 pr-2">Decoded VRML bytes</td>
                <td>{{ formatBytes(source.decodedBytes) }}</td>
              </tr>
              <tr v-if="vrml">
                <td class="opacity-60 pr-2">Header</td>
                <td :class="vrml.headerIsVrml97 ? '' : 'text-red-500'">{{ vrml.header }}</td>
              </tr>
              <tr>
                <td class="opacity-60 pr-2">Texture uploaded</td>
                <td>{{ object.assets.texture ? object.assets.texture.filename : 'none' }}</td>
              </tr>
              <tr v-if="vrml">
                <td class="opacity-60 pr-2">Textures referenced</td>
                <td>{{ textureList }}</td>
              </tr>
              <tr v-if="vrml && vrml.externalReferences.length">
                <td class="opacity-60 pr-2">External references</td>
                <td class="text-red-500">
                  <div v-for="(reference, index) in vrml.externalReferences" :key="index">
                    {{ reference.value }}
                  </div>
                </td>
              </tr>
              <tr v-if="vrml && vrml.viewpoints.length">
                <td class="opacity-60 pr-2">Viewpoints</td>
                <td>{{ viewpointList }}</td>
              </tr>
            </table>
          </section>

          <!-- Raw node counts, as facts rather than judgements -->
          <section v-if="vrml" class="mb-4">
            <h3 class="border-b border-white mb-1">VRML nodes</h3>
            <div v-if="!presentNodes.length" class="opacity-60">
              None of the nodes the Mall rules mention are present.
            </div>
            <div v-else>
              <span v-for="node in presentNodes" :key="node.name" class="inline-block mr-3">
                {{ node.name }}: {{ node.count }}
              </span>
            </div>
            <div v-if="vrml.protoDefinitions.length" class="mt-1">
              <span class="opacity-60">PROTO:</span> {{ vrml.protoDefinitions.join(', ') }}
            </div>
          </section>
        </div>
      </div>

      <!-- Raw source and downloads -->
      <div class="border-t border-white p-2">
        <button class="btn-ui-inline" @click="toggleRawSource">
          {{ showRawSource ? 'Hide' : 'Show' }} raw VRML
        </button>
        <button class="btn-ui-inline" :disabled="isDownloading" @click="downloadSource">
          {{ isDownloading ? 'Preparing...' : 'Download decompressed .wrl' }}
        </button>
        <a v-if="object.assets.thumbnail.url"
           class="btn-ui-inline"
           :href="object.assets.thumbnail.url"
           target="_blank"
           rel="noopener">Thumbnail</a>
        <a v-if="object.assets.texture"
           class="btn-ui-inline"
           :href="object.assets.texture.url"
           target="_blank"
           rel="noopener">Texture</a>
        <a v-if="object.assets.wrl.url"
           class="btn-ui-inline"
           :href="object.assets.wrl.url"
           target="_blank"
           rel="noopener">Original stored bytes</a>
        <p v-if="rawSourceError" class="text-red-400 mt-2">{{ rawSourceError }}</p>
        <pre v-if="showRawSource && rawSource"
             class="mt-2 p-2 overflow-auto text-xs"
             style="max-height: 20rem; background: #001829;">{{ rawSource }}</pre>
      </div>

      <!-- Staff actions, deliberately separated from everything above -->
      <div class="border-t-4 border-red-500 p-2">
        <!--
          The reason is required and goes to the uploader verbatim, so it is a
          full textarea rather than a prompt: staff are writing to a person.
        -->
        <label v-if="canTriage" class="block uppercase text-xs opacity-60 mb-1" for="reject-reason">
          Reason for rejection
        </label>
        <textarea
          v-if="canTriage"
          id="reject-reason"
          v-model="rejectReason"
          class="w-full p-1 mb-2"
          rows="3"
          :maxlength="rejectReasonMax"
          :disabled="isProcessing"
          placeholder="Tell the uploader what needs fixing. Sent to them when you reject."
          style="background: #001829;"
        ></textarea>
        <div class="flex flex-wrap items-center">
        <span class="uppercase text-xs opacity-60 mr-2">Staff actions</span>
        <!--
          Accept and Reject are the Pending triage decisions. The checker is also
          opened from Warehouse, Stocked, Out of Stock and Search, and both
          endpoints mutate status regardless of the current one -- Reject would
          delete and refund a stocked object. Editing stays available everywhere.
        -->
        <template v-if="canTriage">
          <button class="btn mr-2" :disabled="isProcessing" @click="confirmApprove">Accept</button>
          <button class="btn mr-2" :disabled="isProcessing" @click="confirmReject">Reject</button>
        </template>
        <span v-else class="text-xs opacity-60 mr-2">
          Accept and Reject apply to pending objects only.
        </span>
        <button class="btn-ui-inline" :disabled="isProcessing" @click="updateName">
          Edit Name
        </button>
        <button class="btn-ui-inline" :disabled="isProcessing" @click="updateLimit">
          Update Limit
        </button>
        <span v-if="actionError" class="text-red-500 ml-2">{{ actionError }}</span>
        <span v-else-if="actionSuccess" class="text-green ml-2">{{ actionSuccess }}</span>
        </div>
        <!--
          A rejection that could not notify is still a completed rejection, so
          this is a warning to follow up by hand, never an invitation to press
          Reject again.
        -->
        <p v-if="actionWarning" class="text-yellow-400 mt-2 font-bold">{{ actionWarning }}</p>
      </div>
    </template>

    <div v-else class="w-full flex h-full justify-center items-center">Loading&hellip;</div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

import ObjectViewer from "@/components/mall/ObjectViewer.vue";
import {
  REJECT_REASON_MAX,
  objectDisplayName,
  rejectReasonError,
} from "@/pages/mall/staff/mall-actions.mixin";

/**
 * The Mall staff review workspace.
 *
 * Replaces a viewer-only popup that showed no metadata at all. A checker can now
 * see the CTR record, the object's WorldInfo, what its stored file actually is,
 * and where those disagree, without downloading the WRL or opening an external
 * VRML editor.
 */

/** Which list a checker arrived from, and the object status that list shows. */


/** CTR status for an object awaiting Mall review. */
const PENDING_STATUS = 2;

const LIST_STATUS: { [key: string]: number } = {
  pending: PENDING_STATUS,
  warehouse: 3,
  stocked: 1,
};

const LIST_LABELS: { [key: string]: string } = {
  pending: "Pending",
  warehouse: "Warehouse",
  stocked: "Stocked",
  soldout: "Out of Stock",
  search: "Search",
};

/** Node types worth showing a count for, in the order staff read them. */
const REPORTED_NODES = [
  "ImageTexture",
  "PROTO",
  "EXTERNPROTO",
  "Inline",
  "Script",
  "Sound",
  "AudioClip",
  "DirectionalLight",
  "PointLight",
  "SpotLight",
  "Billboard",
  "Viewpoint",
  "TouchSensor",
  "ProximitySensor",
  "TimeSensor",
  "Anchor",
  "hAnim",
];

export default Vue.extend({
  name: "MallChecker",
  components: { ObjectViewer },
  data() {
    return {
      accessDenied: false,
      loadError: "",
      inspection: null,
      rawSource: "",
      rawSourceError: "",
      isDownloading: false,
      /**
       * The object each in-flight fetch was issued for.
       *
       * Staff move through the queue faster than an inspection round-trips, and
       * responses are not guaranteed to arrive in the order they were sent. A
       * slow response for a previous object would otherwise be rendered under
       * the current object's id -- the worst possible failure for a page whose
       * whole job is deciding whether to accept or reject what is on screen.
       */
      inspectionFor: null as number | null,
      rawSourceFor: null as number | null,
      showRawSource: false,
      isProcessing: false,
      actionError: "",
      actionSuccess: "",
      actionWarning: "",
      rejectReason: "",
      rejectReasonMax: REJECT_REASON_MAX,
      queue: {
        ids: [],
        consumed: [],
        total: 0,
        offset: 0,
        limit: 10,
        exhaustedBefore: false,
        exhaustedAfter: false,
      },
    };
  },
  computed: {
    objectId(): number {
      return Number.parseInt(this.$route.params.object_id, 10);
    },
    object(): any {
      return this.inspection.object;
    },
    source(): any {
      return this.inspection.source;
    },
    vrml(): any {
      return this.inspection.vrml;
    },
    comparisons(): any {
      return this.inspection.comparisons;
    },
    from(): string {
      return String(this.$route.query.from || "");
    },
    fromLabel(): string {
      return LIST_LABELS[this.from] || "Mall";
    },
    creatorLabel(): string {
      return this.object.creator.username || "(no creator on record)";
    },
    limitLabel(): string {
      return this.object.limit === null ? "none recorded" : String(this.object.limit);
    },
    storeLabel(): string {
      return this.object.store ? this.object.store.name : "no store";
    },
    encodingLabel(): string {
      if (this.source.encoding === "gzip") {
        return "gzip-compressed VRML";
      }
      if (this.source.encoding === "identity") {
        return "plain VRML";
      }
      return "unreadable";
    },
    textureList(): string {
      if (!this.vrml || !this.vrml.textureReferences.length) {
        return "none";
      }
      return this.vrml.textureReferences.map((reference: any) => reference.value).join(", ");
    },
    viewpointList(): string {
      return this.vrml.viewpoints
        .map((viewpoint: any) => viewpoint.description || viewpoint.defName || "(unnamed)")
        .join(", ");
    },
    presentNodes(): any[] {
      const counts = this.vrml.nodeCounts || {};
      return REPORTED_NODES
        .filter(name => (counts[name] || 0) > 0)
        .map(name => ({ name, count: counts[name] }));
    },
    currentIndex(): number {
      return this.queue.ids.indexOf(this.objectId);
    },
    previousId(): number {
      return this.neighbour(-1);
    },
    nextId(): number {
      return this.neighbour(1);
    },
    /**
     * Findings grouped by severity, most consequential first.
     *
     * "Needs staff review" leads because it means the rest of this page could
     * not be established -- a checker who reads past it is trusting facts the
     * inspection never actually proved. Empty groups are dropped rather than
     * rendered as reassuring empty headings.
     */
    /**
     * Whether this object is awaiting the Pending triage decision.
     *
     * Read from the object's own status rather than the list it was reached
     * from, so a stale `from` in the url cannot re-enable the buttons.
     */
    canTriage(): boolean {
      return !!this.object && this.object.status === PENDING_STATUS;
    },

    findingGroups(): any[] {
      const order = [
        {
          severity: "needs_staff_review",
          label: "Needs staff review",
          className: "text-yellow-400",
        },
        { severity: "warning", label: "Warnings", className: "text-orange-400" },
        { severity: "info", label: "Information", className: "opacity-70" },
      ];
      const findings = (this.inspection && this.inspection.findings) || [];
      return order
        .map(group => ({
          ...group,
          // Findings from an older API build carry no severity; treating them as
          // needing review matches the server's own fallback.
          findings: findings.filter((finding: any) =>
            (finding.severity || "needs_staff_review") === group.severity),
        }))
        .filter(group => group.findings.length > 0);
    },

    queueLabel(): string {
      if (this.currentIndex < 0 || !this.queue.total) {
        return "";
      }
      const position = this.queue.offset + this.currentIndex + 1;
      return `${this.fromLabel} ${position} of ${this.queue.total}`;
    },
    ownUrl(): string {
      return `/#${this.$route.fullPath}`;
    },

  },
  watch: {
    objectId() {
      this.actionError = "";
      this.actionSuccess = "";
      this.actionWarning = "";
      // The reason belongs to the object it was written about.
      this.rejectReason = "";
      this.showRawSource = false;
      this.rawSource = "";
      this.rawSourceError = "";
      this.loadInspection();
    },
  },
  async mounted(): Promise<void> {
    if (!(await this.confirmMallStaff())) {
      return;
    }
    await this.loadInspection();
    await this.loadQueue();
  },
  methods: {
    async confirmMallStaff(): Promise<boolean> {
      try {
        await this.$http.get("/mall/can_admin");
        return true;
      } catch (error) {
        this.accessDenied = true;
        return false;
      }
    },

    async loadInspection(): Promise<void> {
      this.loadError = "";
      if (!Number.isFinite(this.objectId)) {
        this.loadError = "That is not a valid object id.";
        return;
      }
      const requestedFor = this.objectId;
      this.inspectionFor = requestedFor;
      try {
        const response = await this.$http.get(`/mall/object/${requestedFor}/inspection`);
        if (this.inspectionFor !== requestedFor) {
          return; // staff have already moved to another object
        }
        this.inspection = response.data.inspection;
      } catch (errorResponse: any) {
        if (this.inspectionFor !== requestedFor) {
          return;
        }
        const status = errorResponse.response && errorResponse.response.status;
        this.loadError = status === 404
          ? "That object no longer exists."
          : "The object could not be loaded.";
      }
    },

    /**
     * Captures the ordered ids of the list the checker came from, so queue
     * navigation is by id rather than by a position that shifts underneath us
     * the moment an object is accepted or rejected.
     */
    async loadQueue(): Promise<void> {
      const status = LIST_STATUS[this.from];
      if (status === undefined) {
        return;
      }

      const limit = Number.parseInt(String(this.$route.query.limit || "10"), 10) || 10;
      const page = Number.parseInt(String(this.$route.query.page || "1"), 10) || 1;
      const offset = (page - 1) * limit;

      this.queue.limit = limit;
      this.queue.offset = offset;
      const loaded = await this.fetchQueuePage(status, offset, limit);
      this.queue.ids = loaded.ids;
      this.queue.total = loaded.total;
    },

    async fetchQueuePage(status: number, offset: number, limit: number): Promise<any> {
      try {
        const response = await this.$http.get("/mall/all_objects", {
          column: "status",
          compare: "=",
          content: status,
          limit,
          offset: Math.max(offset, 0),
          orderBy: String(this.$route.query.order || "ASC"),
        });
        return {
          ids: response.data.objects.objects.map((entry: any) => entry.id),
          total: response.data.objects.total[0].count,
        };
      } catch (error) {
        return { ids: [], total: 0 };
      }
    },

    /** The nearest id in the captured order that has not been acted on yet. */
    neighbour(step: number): number {
      if (this.currentIndex < 0) {
        return null;
      }
      let index = this.currentIndex + step;
      while (index >= 0 && index < this.queue.ids.length) {
        const candidate = this.queue.ids[index];
        if (this.queue.consumed.indexOf(candidate) === -1) {
          return candidate;
        }
        index += step;
      }
      return null;
    },

    async goTo(objectId: number): Promise<void> {
      if (!objectId) {
        return;
      }
      await this.$router.push({
        name: "mall-checker",
        params: { object_id: String(objectId) },
        query: this.$route.query,
      }).catch(() => undefined);
    },

    /**
     * Extends the captured queue by one page when the checker runs off either
     * end, so the queue is continuous across the list's pagination.
     */
    async extendQueue(direction: number): Promise<boolean> {
      const status = LIST_STATUS[this.from];
      if (status === undefined) {
        return false;
      }
      if (direction < 0 && (this.queue.offset === 0 || this.queue.exhaustedBefore)) {
        return false;
      }
      if (direction > 0 && this.queue.exhaustedAfter) {
        return false;
      }

      // Every consumed object has left the status list this queue pages through
      // (only Accept and Reject mark one consumed, and both change its status),
      // so the server's result set has shifted left by that many rows. Paging
      // forward by the captured length would step past exactly that many
      // objects: capture [1..10], reject 10, and a raw offset of 10 lands on the
      // twelfth object, silently skipping 11.
      //
      // Backward extension needs no such adjustment: removing a row shifts only
      // the rows after it, and everything consumed sits at or after this.offset.
      const consumedInQueue = this.queue.ids
        .filter((id: number) => this.queue.consumed.indexOf(id) !== -1).length;

      const offset = direction < 0
        ? Math.max(this.queue.offset - this.queue.limit, 0)
        : Math.max(this.queue.offset + this.queue.ids.length - consumedInQueue, 0);
      const page = await this.fetchQueuePage(status, offset, this.queue.limit);

      if (!page.ids.length) {
        if (direction < 0) {
          this.queue.exhaustedBefore = true;
        } else {
          this.queue.exhaustedAfter = true;
        }
        return false;
      }

      // Another staff member acting on the same list concurrently can shift the
      // result set further than our own consumption accounts for, which would
      // hand back a row already captured. Duplicate ids would break navigation,
      // which is indexOf-based, so they are dropped rather than appended.
      const known = this.queue.ids;
      const fresh = page.ids.filter((id: number) => known.indexOf(id) === -1);

      if (!fresh.length) {
        if (direction < 0) {
          this.queue.exhaustedBefore = true;
        } else {
          this.queue.exhaustedAfter = true;
        }
        return false;
      }

      if (direction < 0) {
        this.queue.ids = fresh.concat(this.queue.ids);
        this.queue.offset = offset;
      } else {
        this.queue.ids = this.queue.ids.concat(fresh);
      }
      this.queue.total = page.total;
      return true;
    },

    async toggleRawSource(): Promise<void> {
      this.showRawSource = !this.showRawSource;
      if (!this.showRawSource || this.rawSource) {
        return;
      }
      this.rawSourceError = "";
      const requestedFor = this.objectId;
      this.rawSourceFor = requestedFor;
      try {
        const response = await this.$http.get(`/mall/object/${requestedFor}/source`);
        if (this.rawSourceFor !== requestedFor) {
          return;
        }
        this.rawSource = response.data;
      } catch (error) {
        if (this.rawSourceFor !== requestedFor) {
          return;
        }
        // Shown, but deliberately not stored in `rawSource`: caching the failure
        // there makes the `this.rawSource` short-circuit above treat it as a
        // successful fetch, so a transient error would never be retried.
        this.rawSourceError = "The source of this object could not be decoded.";
      }
    },

    /**
     * Saves the decompressed source through the authenticated client.
     *
     * `/mall/object/:id/source` is behind `requireMallStaff`, which authorises
     * from the `apitoken` request header alone. A plain `<a href>` is a browser
     * navigation and cannot carry that header, so linking straight at the
     * endpoint returns 400 even for a signed-in staff member; the bytes have to
     * come back through the api client and be saved from memory instead.
     */
    async downloadSource(): Promise<void> {
      if (this.isDownloading) {
        return;
      }
      this.isDownloading = true;
      this.rawSourceError = "";
      const requestedFor = this.objectId;
      let url = "";
      try {
        const response = await this.$http.get(`/mall/object/${requestedFor}/source`);
        const blob = new Blob([response.data], { type: "model/vrml" });
        url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        // Matches the name the server sends for `?download=1`: never the
        // member-supplied object name, never the stored filename.
        link.download = `object-${requestedFor}.wrl`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (error) {
        this.rawSourceError = "The source of this object could not be downloaded.";
      } finally {
        if (url) {
          // Deferred a tick: some browsers fetch the blob url after the current
          // task ends, and revoking synchronously cancels the download.
          const pending = url;
          window.setTimeout(() => window.URL.revokeObjectURL(pending), 0);
        }
        this.isDownloading = false;
      }
    },

    confirmApprove(): void {
      if (!window.confirm(`Accept "${this.object.name}" (#${this.object.id})?`)) {
        return;
      }
      this.performAction("/mall/approve", { objectId: this.object.id }, "Object accepted.");
    },

    confirmReject(): void {
      const reason = this.rejectReason.trim();
      const invalid = rejectReasonError(reason);
      if (invalid) {
        this.actionError = invalid;
        this.actionSuccess = "";
        this.actionWarning = "";
        return;
      }
      if (!window.confirm(
        `Reject "${this.object.name}" (#${this.object.id})?\n\n` +
        `The uploader will be sent this reason:\n\n${reason}`,
      )) {
        return;
      }
      this.rejectObject(reason);
    },

    /**
     * Rejection has three outcomes, and they must not be conflated.
     *
     * A failure leaves the reason typed and the object in place so it can be
     * retried. A success that could not notify is still a completed rejection --
     * the refund has already happened -- so it advances like any other success
     * and warns rather than inviting a second Reject.
     */
    async rejectObject(reason: string): Promise<void> {
      // Captured before the request, because a success advances the queue and
      // `this.object` is then the next object rather than the rejected one.
      const rejectedName = objectDisplayName(this.object);

      const data = await this.performAction(
        "/mall/reject",
        { id: this.object.id, reason },
        "Object rejected and the uploader notified.",
      );

      if (this.actionError) {
        return;
      }

      this.rejectReason = "";
      if (data && data.notified === false) {
        // Set after the queue has advanced, so navigation does not clear it.
        this.actionSuccess = "Object rejected.";
        this.actionWarning = `${rejectedName} was rejected, but the uploader `
          + "could not be notified. Follow up manually.";
      }
    },

    /** Returns the response body so a caller can act on what the server reported. */
    async performAction(endpoint: string, body: any, success: string): Promise<any> {
      if (this.isProcessing) {
        return null;
      }
      this.isProcessing = true;
      this.actionError = "";
      this.actionSuccess = "";
      this.actionWarning = "";
      let data: any = null;
      try {
        const response: any = await this.$http.post(endpoint, body);
        data = response && response.data;
        this.actionSuccess = success;
        await this.advancePastCurrent();
      } catch (errorResponse: any) {
        const errorData = errorResponse.response && errorResponse.response.data;
        this.actionError = (errorData && errorData.error) || "An unknown error occurred";
      } finally {
        this.isProcessing = false;
      }
      return data;
    },

    /**
     * Marks the object just acted on as consumed and moves to the next id in the
     * captured queue. Deliberately not a re-query and re-index: the underlying
     * result set shifts the moment an object leaves the list, so an index-based
     * step would silently skip the neighbour.
     */
    async advancePastCurrent(): Promise<void> {
      if (this.queue.consumed.indexOf(this.objectId) === -1) {
        this.queue.consumed.push(this.objectId);
      }

      let target = this.nextId;
      if (!target && await this.extendQueue(1)) {
        target = this.nextId;
      }
      if (!target) {
        target = this.previousId;
      }

      if (target) {
        await this.goTo(target);
      } else {
        this.backToList();
      }
    },

    async updateName(): Promise<void> {
      const current = this.object.name;
      const updated = window.prompt(`Current Name:\n ${current}\n\nNew Name:`, current);
      if (updated === null || updated === "") {
        return;
      }
      await this.performStaffEdit(
        "/mall/updateObjectName",
        { objectId: this.object.id, name: updated },
        "Object name updated.",
      );
    },

    async updateLimit(): Promise<void> {
      const entered = window.prompt(
        "Update limit to this object\n NOTE: Setting the limit to 0 makes it Unlimited\n",
      );
      if (entered === null || entered === "") {
        return;
      }
      const digits = entered.replace(/[^0-9]/g, "");
      if (digits !== entered) {
        this.actionError = "Use whole numbers only!";
        return;
      }
      if (digits !== "0" && Number.parseInt(digits, 10) < this.object.quantity) {
        this.actionError = "Limit cannot be less than the uploaded quantity.";
        return;
      }
      await this.performStaffEdit(
        "/mall/limit",
        { objectId: this.object.id, limit: digits },
        "Object limit updated.",
      );
    },

    /**
     * The buttons already bind `:disabled="isProcessing"`, but nothing here ever
     * set it -- so an edit left them live and a second click sent a second
     * mutation against the same object while the first was still in flight.
     */
    async performStaffEdit(endpoint: string, body: any, success: string): Promise<void> {
      if (this.isProcessing) {
        return;
      }
      this.isProcessing = true;
      this.actionError = "";
      this.actionSuccess = "";
      this.actionWarning = "";
      try {
        await this.$http.post(endpoint, body);
        this.actionSuccess = success;
        await this.loadInspection();
      } catch (errorResponse: any) {
        const data = errorResponse.response && errorResponse.response.data;
        this.actionError = (data && data.error) || "An unknown error occurred";
      } finally {
        this.isProcessing = false;
      }
    },

    /**
     * Returns to the list the checker was opened from, carrying back every
     * parameter that list uses - page and sort for the status lists, the search
     * term for Search - so a review never costs the checker their place.
     */
    backToList(): void {
      if (!LIST_LABELS[this.from]) {
        this.$router.push({ path: "/mall/pending" }).catch(() => undefined);
        return;
      }
      const query: any = {};
      Object.keys(this.$route.query).forEach(key => {
        if (key !== "from") {
          query[key] = this.$route.query[key];
        }
      });
      this.$router.push({ path: `/mall/${this.from}`, query }).catch(() => undefined);
    },

    displayValue(value: any): string {
      if (value === null || value === undefined || value === "") {
        return "-";
      }
      return String(value);
    },

    verdictClass(verdict: string): string {
      if (verdict === "MATCH") {
        return "text-green";
      }
      if (verdict === "MISMATCH") {
        return "text-red-500";
      }
      return "opacity-60";
    },

    formatBytes(bytes: number): string {
      if (bytes === null || bytes === undefined) {
        return "-";
      }
      return `${bytes.toLocaleString()} bytes`;
    },

    formatDate(value: string): string {
      if (!value) {
        return "unknown";
      }
      return new Date(value).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    },
  },
});
</script>
