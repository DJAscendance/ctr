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
    <!--
      Block layout, not a flex column, and deliberately so. The original rendered
      this page as ordinary document flow: a <center> block holding the management
      control and the place heading, and then the place's own body text below it,
      left-aligned like any other paragraph.

      A flex column shrink-wraps its items to the widest child, so "centered"
      became "centered over the information text" rather than centered on the
      page. Normal block flow makes the centered section full width, which is what
      restores the classic presentation.
    -->
    <div class="h-full w-full bg-black" style="padding: 10px" v-else>
      <!--
        The centered section, and ONLY this section. The classic markup was a
        <center> block holding the MANAGE control and, under a <br>, the place
        heading - and nothing else.

        The manager-authored information below is explicitly OUTSIDE it, so a
        place's own text keeps whatever alignment its author gave it instead of
        being force-centered by the page. `center` is in the shared sanitizer
        allowlist, so an author who wants centered text can still say so.
      -->
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
        <!--
          Display only. The editor behind MANAGE writes place.description and
          nothing else - editing a place's information never renames it.
        -->
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
      // Monotonic request id. The Information window is a popup that reuses ONE
      // component instance for every #/information/<type>/<id>/<slug> target, so
      // navigating straight from one place to another re-runs these fetches
      // without a remount. Only the response whose token still matches the
      // current value may write to the component; anything older belongs to a
      // superseded route and is discarded. Without this, a slow response for
      // place A can land after a fast one for place B and repaint A's name,
      // information, staffing - or A's Manage button - over B.
      loadToken: 0,
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
    async getPlaceInformation(token: number): Promise<void> {
      if (!this.supportsPlaceInformation) {
        return;
      }
      const placeId = this.$route.params.id;
      try {
        const response = await this.$http.get(`/place/${placeId}/information`);
        if (token !== this.loadToken) return;
        this.placeName = response.data.name || "";
        this.placeDescription = response.data.description || "";
      } catch (e) {
        if (token !== this.loadToken) return;
        this.placeName = "";
        this.placeDescription = "";
      }
      // Purely to decide whether to draw the Manage button. The editor route and
      // the update endpoint both re-check, so a stale or forced answer here
      // grants nothing. It is still sequenced: the PREVIOUS place's answer must
      // never be the one that leaves a Manage button on screen for this one.
      try {
        const response = await this.$http.get(
          `/place/${placeId}/information/can_edit`,
        );
        if (token !== this.loadToken) return;
        this.canEditInformation = response.data.result === true;
      } catch (e) {
        if (token !== this.loadToken) return;
        this.canEditInformation = false;
      }
    },
    /**
     * Clears every field this window renders and reloads for the CURRENT route.
     *
     * Called on mount and again whenever the route changes underneath the popup.
     * State is cleared synchronously and BEFORE the requests start, so nothing
     * from the previous place - not its name, its information, its staffing, nor
     * its Manage capability - can remain visible while the new place loads.
     */
    reload(): void {
      const token = ++this.loadToken;
      this.owner = null;
      this.deputies = [];
      this.securityInfo = {};
      this.homeDescription = null;
      this.placeName = "";
      this.placeDescription = "";
      this.canEditInformation = false;
      this.getData(token);
      this.getPlaceInformation(token);
    },
    async getData(token: number): Promise<void> {
      let infopoint = null;
      switch (this.$route.params.type) {
      case "home":
        // Homes have no leader/deputy structure - the Information tool shows the owner's
        // own description instead, so this branch returns before the access-info fetch.
        this.$http.get(`/home/information/${this.$route.params.id}`).then((response) => {
          if (token !== this.loadToken) return;
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
        if (token !== this.loadToken) return;
        if (this.$route.params.slug === "jail") {
          this.securityInfo = response.data.securityInfo;
        }
        else {
          if (response.data.data.owner.length !== 0) {
            this.owner = response.data.data.owner[0].username;
          } else {
            this.owner = "";
          }
          // Assigned as a whole new array rather than written index by index:
          // per-index assignment is not reactive in Vue 2, and it would also
          // leave the previous place's extra deputies in place when the new one
          // has fewer.
          this.deputies = response.data.data.deputies.slice();
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
    this.reload();
  },
  watch: {
    /**
     * The popup reuses one component for every Information target, so changing
     * the route does NOT remount it. Watching $route is the smallest mechanism
     * that covers every way the target can change - type, id or slug - including
     * a change of type alone (hood -> block) or of slug alone (a public place),
     * which a watcher on a single param would miss.
     *
     * Vue 2's $route object is replaced on every navigation, so this fires once
     * per navigation without needing `deep`.
     */
    $route(to, from) {
      if (
        to.params.type === from.params.type &&
        to.params.id === from.params.id &&
        to.params.slug === from.params.slug
      ) {
        return;
      }
      this.reload();
    },
  },
});
</script>
