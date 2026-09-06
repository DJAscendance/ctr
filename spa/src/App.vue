<template>
  <main id="app" class="h-screen" style="display:grid;">
    <!--Banner-->
    <div
      class="flex bg-lines justify-center"
      style="height: 70px;"
      v-if="$store.data.isUser && this.$route.meta.wrapper"
    >
      <div style="width: 100%; display:grid; grid-template-columns: 1fr 5fr 1fr;">
        <div ></div>
        <div class="flex h-full items-center" style="justify-content: center;">
          <img src="/assets/img/ctMinaBanner.gif" />
        </div>
        <div class="flex h-full items-center px-5" style="justify-content:right">
          <img src="/assets/img/news.gif" />
        </div>
      </div>
    </div>
    <!--Body-->
    <div>
      <div
        class="flex flex-row flex-grow"
        :style="$store.data.isUser && this.$route.meta.wrapper ? 'height: calc(100vh - 70px) !important' : 'height: 100vh !important'"
      >
        <!--Content-->
        <div class="flex flex-1">
          <router-view
            v-if="this.$route.name !== 'world-browser' &&
            this.$route.name !== 'user-home'" />
          <world-browser-page
            v-show="this.$route.name === 'world-browser' ||
            this.$route.name === 'user-home'"></world-browser-page>
        </div>
        <!--Navigation Panel-->
        <div
          class="flex-none w-60 bg-lines overflow-y-auto"
          v-if="$store.data.isUser && this.$route.meta.wrapper"
        >
          <div class="flex flex-col">
            <div class="flex justify-center">
              <img src="/assets/img/logo-action.gif" />
          </div>
          <div class="text-clock text-center w-full py-0.5">
          <ClockPage />
          </div>
          <div class="flex justify-center w-full pb-5 cursor-pointer">
            <div>
              <center>
                <span class="underline" style="color: yellow;" @click="openCitizenOnlineModal">Citizens Online</span>
                <!-- TO DO - Button hidden until we have City Guides and functionality gets added to the button -->
                <!-- <button class="btn-ui" @click="callGuide"><font color='lime' size="1.5rem">Call a Guide</font></button> -->
              </center>
            </div>
          </div>
          <div class="flex flex-row justify-center" v-if="$store.data.place.name">
            <span class="inline" style="color:lime;">{{ $store.data.place.name }}</span> 
          </div>
            <!--
              Outlands never offered a 2D/3D choice: its entrance led straight
              into the 3D battle zone and there was no 2D Outlands room. The
              selector is withheld while the historical entrance is up.
            -->
            <div class="flex flex-row justify-center" v-if="!outlandsEntrance">
              <img src="/assets/img/b2dchat.gif" @click="$store.methods.setView3d(false)"
                  class="cursor-pointer"/>
              <img src="/assets/img/b3dchat.gif" @click="$store.methods.setView3d(true)"
                  class="cursor-pointer"/>
            </div>
            <div class="flex justify-center">
              <div class="menu">
                <a href="#"
                  class="menuLink"
                  @click.prevent="openInfoModal"
                  style="top: 78px"
                ></a>
                <router-link
                  class="menuLink"
                  style="top: 98px"
                  v-if="$store.data.user.hasHome"
                  :to="'/home/'+$store.data.user.username"
                ></router-link>
                <router-link to="/citymap"
                  class="menuMapLink"
                ></router-link>
              </div>
            </div>
            <div class="flex justify-center" v-if="isVotingOpen">
              <img src="/assets/img/vote_button.png" @click="openWindow('#/mayorelection')"
                  class="cursor-pointer" style="width: 85px; height: 70px;" />
            </div>
            <div class="flex justify-center" v-else>
              <!--
                The Outlands event button. Historically this art was the
                control panel's Outlands entry point: place_002.html wraps
                outlandico.jpg in a link to `place?plc=ne_game` with
                target="_top". The legacy resolver maps that same `plc` name to
                the `outlands` slug, so this route is the same destination.
              -->
              <router-link to="/place/outlands">
                <img src="/assets/img/outlandico.jpeg" alt="Enter Outlands" />
              </router-link>
            </div>
            <div class="px-8">
              <select
                class="w-full text-black"
                @change="changeJumpGate()"
                v-model="jumpGate"
              >
                <option value="">JUMP GATE</option>
                <option value=""></option>
                <option v-for="option in jumpGateData" :value="option.slug">
                  {{ option.title }}
                </option>
              </select>
            </div>
            <div>
              <br />
              <router-view name="tools"></router-view>
              <a
                href="https://github.com/CybertownRevival/ctr/issues"
                class="btn-ui"
                target="_blank"
                >
                Report a Bug
              </a>
              <br />
              <router-link to="/logout" class="btn-ui">Logout</router-link>
              <br />
              <p align="center">
                <a
                  href="https://kdaws.com/"
                  target="_blank"
                  class="text-center inline-block p-3 rounded-sm"
                  style="margin: 0 auto"
                >
                  <img
                    src="/assets/img/kda-logo-white.png"
                    style="width: 96px; height: auto"
                    title="Hosted by KDA Web Services"
                  />
                </a>
                <br />
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
    <ModalRoot />
  </main>
</template>

<script lang="ts">
import Vue from "vue";

import WorldBrowserPage from "./pages/world-browser/WorldBrowserPage.vue";
import ModalRoot from "./components/modals/ModalRoot.vue";
import InfoModal from "./components/modals/InfoModal.vue";
import SecurityAlertModal from './components/modals/SecurityAlertModal.vue';
import CitizenOnlineModal from './components/modals/CitizenOnlineModal.vue';
import ModalService from "./components/modals/services/ModalService.vue";
import ClockPage from "./components/Clock.vue";
import { outlandsEntranceActive } from "@/libs/outlands";
import InstantMessageModal from './components/modals/InstantMessageModal.vue';

declare const X3D: any;

export default Vue.extend({
  name: "App",
  components: {
    ClockPage,
    WorldBrowserPage,
    ModalRoot,
  },
  data: () => {
    return {
      accessLevel: null,
      jumpGateData: [
        {
          title: "COLONIES:",
          slug: "",
        },
        {
          title: "Sci-fi",
          slug: "scifi_col",
        },
        {
          title: "Entertainment",
          slug: "ent_col",
        },
        {
          title: "Games",
          slug: "games_col",
        },
        {
          title: "Virtual Worlds",
          slug: "vrtwrlds_col",
        },
        {
          title: "Cyberhood",
          slug: "cyberhood",
        },
        {
          title: "Inner Realms",
          slug: "inrlms_col",
        },
        {
          title: "The Campus",
          slug: "campus",
        },
        {
          title: "Adventure",
          slug: "ad_col",
        },
        {
          title: "Hi-Tek",
          slug: "hitek_col",
        },
        {
          title: "9th Dimension",
          slug: "9thdimension",
        },
        {
          title: "-----------------------",
          slug: "",
        },
        {
          title: "The Plaza",
          slug: "enter",
        },
        {
          title: "Newcomers Club",
          slug: "newcomers",
        },
        {
          title: "Employment Office",
          slug: "employment",
        },
        {
          title: "Flea Market",
          slug: "fleamarket",
        },
        {
          title: "Mall",
          slug: "mall",
        },
        {
          title: "The Clubs",
          slug: "clubdir",
        },
        {
          title: "Bank",
          slug: "bank",
        },
        {
          title: "Sunset Beach",
          slug: "beach",
        },
        {
          title: "Water Park",
          slug: "waterpark",
        },
        {
          title: "Theme Park",
          slug: "themepark",
        },
        {
          title: "City Hall",
          slug: "cityhall",
        },
        {
          title: "Performing Arts",
          slug: "theatre",
        },
        {
          title: "The Pool",
          slug: "pool",
        },
        {
          title: "The Stadium",
          slug: "stadium",
        },
        {
          title: "The Post Office",
          slug: "postoffice",
        },
        {
          title: "Game Show",
          slug: "gameshow",
        },
        {
          title: "Black Market",
          slug: "blackmarket",
        },
        {
          title: "Jail",
          slug: "jail",
        },
        {
          title: "Fun Park",
          slug: "funpark",
        },
        {
          title: "Theatre",
          slug: "theatre",
        },
        {
          title: "(more coming soon)",
          slug: "",
        },
        /* For the curious developers. These worlds need fixing to work (see dev tools console)
               
                {
                    'title': 'Employment Office',
                    "slug": "employment"
                },
                {
                    'title': 'Outlands',
                    "slug": "outlands"
                },
                {
                    'title': 'Le Cafe',
                    "slug": "cafe"
                },
                {
                    'title': 'Library (missing wrl)',
                    "slug": "library"
                },
                {
                    'title': 'Fun Park',
                    "slug": "funpark"
                },
                {
                    'title': 'Fun Park',
                    "slug": "funpark"
                },

                 */
      ],
      jumpGate: "",
      isVotingOpen: false,
    };
  },
  methods: {
    changeJumpGate(): void {
      if (this.jumpGate?.length) {
        this.$router.push({ path: `/place/${this.jumpGate}` });
        this.jumpGate = "";
      }
    },
    checkVotingStatus(): void {
      const currentEST = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
      const now = new Date(currentEST);
      // Start: March 23, 2026 00:00:00 at -04:00
      const start = new Date("2026-03-22T12:00:00-04:00");
      // End: March 30, 2026 23:59:59 at -04:00
      const end = new Date("2026-03-30T23:59:59-04:00");
      this.isVotingOpen = now >= start && now <= end;
    },
    reloadWindow(): void {
      window.location.reload();
    },
    openInfoModal(): void {
      ModalService.open(InfoModal);
    },
    openCitizenOnlineModal(): void {
      ModalService.open(CitizenOnlineModal);
    },
    openNotificationModal(data): void {
      ModalService.open(SecurityAlertModal, {
        data: data.data,
      });
    },
    openWindow(url: string): void {
      window.open(url, "targetWindow", "height=650,width=800,menubar=no,status=no");
    },
    receivedInstantMessage(){
      ModalService.open(InstantMessageModal);
    },
    callGuide(){
      // TO DO
      // Add message/alert emit to all online City Guide members containing username and place the member is calling from.
    },
    securityListener(): void {
      this.$socket.on("new-security-alert", data => {
        this.openNotificationModal(data);
      });
    },
    moderationListener(): void {
      this.$socket.on("moderation_event", data => {
        if(
          data.data.event === 'add-ban' && 
          Number.parseInt(data.data.member_id) === this.$store.data.user.id &&
          data.data.duration >= 1) {
          this.reloadWindow();
        } 
        if(
          data.data.event === 'add-ban' && 
          Number.parseInt(data.data.member_id) === this.$store.data.user.id &&
          data.data.duration === 0) {
          alert("You have received a warning from security.\nPlease read and follow the rules & regulations of CTR.")
        }
      });
    },
    instantMessagingListener(): void {
      this.$socket.on("instant-message-received", data => {
        this.receivedInstantMessage();
      })
    },
    async checkAccessLevel() {
      try {
        await this.$http.get(`/member/getadminlevel`)
          .then((response) => {
            this.accessLevel = response.data.accessLevel;
            if(this.accessLevel.includes('security')){
              this.securityListener();
            }
          });
      } catch (error) {
        this.accessLevel = null;
      }
    },
  },
  mounted() {
    this.checkVotingStatus();
    this.checkAccessLevel();
    this.instantMessagingListener();
    this.moderationListener();
    //todo populate jumpgate with worlds
    X3D(
      () => {
        console.log("starting X3d");
        this.$store.data.x3dReady = true;
      },
      (error) => {
        console.error(error);
      },
    );
    // Compatibility shim must run before any patch so the patches can rely
    // on X3D.require and X3D.fieldDefs regardless of the X_ITE version.
    require("./libs/x_ite_mods/x_ite_compat.js");

    // Each patch is isolated: one failing patch must not stop the others.
    const x3dPatches = [
      "vrml_scalar_types.js",
      "vrml_texture_color.js",
      "vrml_nav_default.js",
      "relax_route.js",
      "relax_is.js",
      "arrow_keys.js",
      "viewpoint_bind.js",
      "allow_sf_string.js",
      "bxx_auth.js",
      "bxx_events.js",
      "bxx_rayhit.js",
      "bxx_avatars.js",
      "legacy_links.js",
      "scene_cache.js",
      //'speed_multiplier.js',
      //'fix_stairs.js',
    ];
    for (const patch of x3dPatches) {
      try {
        require(`./libs/x_ite_mods/${patch}`);
      } catch (error) {
        console.warn(`failed to load X_ITE patch ${patch}`, error);
      }
    }
  },
  computed: {
    /** True while the historical Outlands entrance replaces the place screen. */
    outlandsEntrance(): boolean {
      return outlandsEntranceActive(this.$store.data.place, this.$store.data.user);
    },
  },
});
</script>
