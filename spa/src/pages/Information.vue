<template>
  <div>
    <!--
      A home's Information is the free text its owner wrote. It is rendered through Vue's
      text interpolation (never v-html), so any markup a citizen types is escaped and
      displayed literally rather than executed. pre-wrap preserves the owner's line breaks.

      Homes are not staff-managed places: no Manage button, no place heading. They have
      their own owner-facing Update tool.
    -->
    <div
      class="h-full w-full bg-black flex flex-col"
      style="padding: 10px; white-space: pre-wrap;"
      v-if="$route.params.type === 'home'"
    >{{ homeDescription || 'This citizen has not added any information yet.' }}</div>
    <!--
      Every staff-managed place - colony, neighborhood, block, and the public places
      including the Mall and the jail - renders in one order:

          MANAGE (authorized staff only)  ->  place heading  ->  information  ->  staffing

      Classic ordering, restored: the place's own information text sits between the
      place heading and its staffing listing. In blaxxun CS 4.0 the block and
      neighborhood info templates rendered <$TXT> and then included
      common/inforoles.tmpl (Owner/Assistants) and the Leaders/Deputies lists
      directly beneath it - see docs/research/classic-place-admin-re-evidence.md
      section 4.3.

      The place NAME is display only. The editor behind Manage writes exactly one
      column, place.description; renaming a place is not part of this tool.
    -->
    <div class="h-full w-full bg-black flex flex-col" style="padding: 10px" v-else>
      <div class="text-center">
        <!--
          The classic MANAGE button, in the same treatment the Inbox and Message
          Board already use for theirs (pages/Inbox.vue, pages/MessageBoard.vue):
          the same .btn-ui chrome inside the same centred bordered frame, so the
          three windows present one management control, not three.

          Shown only to staff the SERVER says may edit. That is presentation, not
          security - PUT /place/:placeId/information re-checks independently, so a
          forced button or a pasted editor URL changes nothing.
        -->
        <div class="flex flex-row justify-center" v-if="canEditInformation">
          <div class="flex border-4 border-black justify-center">
            <button class="btn-ui" @click="manage" data-testid="place-manage">
              MANAGE
            </button>
          </div>
        </div>
        <h2 v-if="placeName">Welcome to: {{ placeName }}</h2>
      </div>

      <place-information :description="placeDescription"></place-information>

      <!-- The jail lists its staff by job rather than as Leader/Deputies. -->
      <template v-if="$route.params.slug === 'jail'">
        <div v-for="(job, index) in securityInfo" :key="index">
          <div class="pb-2.5" v-if="job.length > 0">
            <p>
              {{ index }}<br/>
            </p>
            <ul>
              <li v-for="name in job">
                <span class="text-chat cursor-pointer underline"
                      v-on:click="opener(`#/home/${name}`)">{{ name }}</span>
              </li>
            </ul>
          </div>
        </div>
      </template>

      <template v-else>
        <div>
          Leader<br/>
          <span style="color: #00df00; text-decoration: underline; cursor: pointer;"
                v-on:click="opener('#/home/'+owner)">{{ owner }}
          </span>
        </div>
        <div style="padding-top: 10px">
          <p>Deputies</p>
          <ul>
            <li v-for="deputy in deputies">
              <span style="color: #00df00; text-decoration: underline; cursor: pointer"
                    v-on:click="opener('#/home/'+deputy.username)">
              {{ deputy.username }}
              </span>
            </li>
          </ul>
        </div>
      </template>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

import PlaceInformation from "@/components/place/PlaceInformation.vue";

/**
 * Place types whose rows carry staff-managed information. Mirrors
 * PlaceInformationService.SUPPORTED_PLACE_TYPES on the server, which is the
 * authority - this list only decides whether to bother asking.
 */
const INFORMATION_TYPES = ["block", "hood", "colony", "public"];

export default Vue.extend({
  name: "InformationPage",
  components: { PlaceInformation },
  data: () => {
    return {
      owner: null,
      deputies: [],
      securityInfo: {},
      homeDescription: null,
      placeName: "",
      placeDescription: "",
      canEditInformation: false,
    };
  },
  computed: {
    supportsPlaceInformation(): boolean {
      return INFORMATION_TYPES.includes(this.$route.params.type);
    },
  },
  methods: {
    /** Opens the scoped editor for this place's information. */
    manage(): void {
      this.$router.push({
        name: "place-update-information",
        params: { placeId: String(this.$route.params.id) },
      });
    },
    /**
     * Loads the place's staff-authored name and information.
     *
     * The description is already sanitized server-side, and PlaceInformation
     * renders it as HTML on that basis. Failures degrade to no information rather
     * than blocking the staffing listing, which is the more important content
     * here.
     */
    async getPlaceInformation(): Promise<void> {
      if (!this.supportsPlaceInformation) {
        return;
      }
      const placeId = this.$route.params.id;
      try {
        const response = await this.$http.get(`/place/${placeId}/information`);
        this.placeName = response.data.name || "";
        this.placeDescription = response.data.description || "";
      } catch (e) {
        this.placeName = "";
        this.placeDescription = "";
      }
      // Purely to decide whether to draw the Manage button. The editor route and
      // the update endpoint both re-check, so a stale or forced answer here
      // grants nothing.
      try {
        const response = await this.$http.get(
          `/place/${placeId}/information/can_edit`,
        );
        this.canEditInformation = response.data.result === true;
      } catch (e) {
        this.canEditInformation = false;
      }
    },
    async getData(): Promise<void> {
      let infopoint = null;
      switch (this.$route.params.type) {
      case "home":
        // Homes have no leader/deputy structure - the Information tool shows the owner's
        // own description instead, so this branch returns before the access-info fetch.
        this.$http.get(`/home/information/${this.$route.params.id}`).then((response) => {
          this.homeDescription = response.data.description;
        });
        return;
      case "block":
        infopoint = `/block/${
          this.$route.params.id
        }/getAccessInfo/`;
        break;
      case "hood":
        infopoint = `/hood/${
          this.$route.params.id
        }/getAccessInfo/`;
        break;
      case "colony":
        infopoint = `/colony/${
          this.$route.params.id
        }/getAccessInfo/`;
        break;
      case "public": {
        if (this.$route.params.slug === "jail") {
          infopoint = "/place/getSecurityInfo";
        } else {
          infopoint = `/place/getAccessInfo/${this.$route.params.slug}/${this.$route.params.id}`;
        }
        break;
      }
      case "shop": {
        infopoint = "/place/getAccessInfo/mall";
        break;
      }
      case "club": {
        infopoint = `/place/getAccessInfo/personalclub/${this.$route.params.id}`;
        break;
      }
      default:
        break;
      }
      this.$http.get(infopoint).then((response) => {
        if (this.$route.params.slug === "jail") {
          this.securityInfo = response.data.securityInfo;
        }
        else {
          if (response.data.data.owner.length !== 0) {
            this.owner = response.data.data.owner[0].username;
          } else {
            this.owner = "";
          }
          response.data.data.deputies.forEach((username, index) => {
            this.deputies[index] = username;
          });
        }
      });
      return;
    },
    async opener(link): Promise<void> {
      window.opener.location.href = link;
      window.close();
    },
  },
  mounted() {
    this.getData();
    this.getPlaceInformation();
  },
});
</script>
