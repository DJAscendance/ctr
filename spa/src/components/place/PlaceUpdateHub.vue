<template>
  <div class="h-full w-full bg-black flex flex-col p-2" v-if="loaded">
    <template v-if="denied">
      <p class="text-center text-red-500">Insufficient access rights.</p>
      <p class="text-center">
        <button type="button" class="btn" @click="back">Back</button>
      </p>
    </template>

    <template v-else>
      <!--
        Deliberately the same screen as "Update your Home"
        (pages/home/HomeUpdatePage.vue): a heading, a one-line lead, then a
        three-column grid of the classic Update Wizard icons with a bold label
        under each. Only the subject differs - a colony, neighborhood or block
        instead of a citizen's home. The original made the same choice: CS 4.0's
        place wizards reused the property wizard's furniture rather than
        inventing a second look.
      -->
      <div class="text-center mb-3">
        <h3>Update the {{ tierNoun }} '{{ hub.name }}'</h3>
        <p>Here you can change this {{ tierNoun }}'s information and more ...!</p>
      </div>

      <!--
        The tool list comes from the catalogue in helpers/place-update-hub.helper,
        filtered by the capabilities the SERVER granted. Colony, Neighborhood and
        Block all render through this one component so they cannot drift apart.

        It is deliberately SHORT. Only capabilities placed in the hub appear here
        (CAPABILITY_PLACEMENT in that helper). Message to All, Inbox to All,
        Access Rights and Check Images are permanent tool-bar buttons and stay
        there; message-board and inbox moderation are reached from the place's own
        Messages and Inbox windows. A member may well hold those capabilities and
        still see only one or two tiles - that is correct, not a bug.

        Nothing here is an access control. Every route and popup below is
        independently authorized by its own endpoint; this only decides what to
        draw.
      -->
      <div
        class="mx-auto max-w-2xl grid grid-cols-3 gap-4"
        data-testid="update-hub-tiles"
      >
        <div
          v-for="tile in tiles"
          :key="tile.key"
          :data-capability="tile.key"
          class="text-center"
        >
          <router-link v-if="tile.kind === 'route'" :to="targetFor(tile)">
            <img :src="tile.image" :alt="tile.label" />
            <br /><strong>{{ tile.label }}</strong>
          </router-link>
          <a v-else :href="hrefFor(tile)" @click="openWindow($event, tile)">
            <img :src="tile.image" :alt="tile.label" />
            <br /><strong>{{ tile.label }}</strong>
          </a>
        </div>
      </div>

      <!--
        Children are listed for navigation and administration only. Listing a
        neighborhood or a block confers no authority over it - each child's own
        Update page re-checks the actor, and there is deliberately no control here
        to add, remove or reposition one.
      -->
      <div v-if="showsChildren" class="mt-4" data-testid="update-hub-children">
        <p class="text-center"><strong>{{ childHeading }}</strong></p>
        <p v-if="children.length === 0" class="text-center">
          <small>{{ emptyChildMessage }}</small>
        </p>
        <ul v-else class="flex flex-wrap justify-center gap-x-4 list-none p-0">
          <li v-for="child in children" :key="child.id">
            <router-link :to="childRoute(child)">{{ child.name }}</router-link>
          </li>
        </ul>
      </div>

      <!--
        Stated in the UI, not only in the docs, so nobody goes looking for a
        missing button. Cybertown's colony maps were custom image maps whose
        neighborhood coordinates were hard-coded in the server's own template
        (blaxxun CS 4.0 templates/community/present.tmpl); changing one meant
        editing that file and its JPEG. Stock CS 4.0 had no colony Update page and
        no colony wizard at all, so no role - including Administrator - is offered
        a structural map control here. See
        docs/research/classic-update-hierarchy-matrix.md sections 0.1 and 0.3.
      -->
      <p v-if="hub.type === 'colony'" class="mt-4 text-center" data-testid="colony-map-notice">
        <small>
          The colony map's layout is fixed. Adding, removing or repositioning a
          neighborhood is not done from this page.
        </small>
      </p>

      <p class="text-center mt-4">
        <button type="button" class="btn" @click="back">Back</button>
      </p>
    </template>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

import {
  childListCapability,
  tileHref,
  tileRoute,
  visibleTiles,
} from "@/helpers";
import { HubContext } from "@/helpers/place-update-hub.helper";

/**
 * The scoped place Update hub, shared by Colony, Neighborhood and Block.
 *
 * The Neighborhood and Block hubs restore an original screen: both action bars
 * carried an Update button behind `#ifdef owneraccess` opening a per-place wizard
 * (blaxxun CS 4.0 templates/neighbor/action.tmpl:43-44,
 * templates/block/action.tmpl:37-41).
 *
 * The Colony hub is a MODERN COMPOSITION of authentic Cybertown tools, not a
 * restoration - stock CS 4.0's colony action bar had no Update button and
 * `community.exe` carries no wizard dispatch at all.
 */
export default Vue.extend({
  name: "PlaceUpdateHub",
  props: {
    placeId: { type: Number, required: true },
    /**
     * The tier this route is mounted under. Compared against the type the SERVER
     * reports for the stored place row: a mismatch (say /block/<a hood id>/update)
     * is refused rather than rendered with the wrong tier's tools.
     */
    expectedType: { type: String, required: true },
  },
  data() {
    return {
      loaded: false,
      denied: false,
      hub: null,
      children: [],
    };
  },
  computed: {
    context(): HubContext {
      return {
        placeId: this.hub.placeId,
        type: this.hub.type,
        slug: this.hub.slug,
      };
    },
    tiles(): any[] {
      if (!this.hub) return [];
      return visibleTiles(this.hub.type, this.hub.capabilities);
    },
    /** What this tier is called in the heading and lead. */
    tierNoun(): string {
      if (!this.hub) return "place";
      if (this.hub.type === "colony") return "colony";
      if (this.hub.type === "hood") return "neighborhood";
      return "block";
    },
    showsChildren(): boolean {
      if (!this.hub) return false;
      const capability = childListCapability(this.hub.type);
      return !!capability && this.hub.capabilities.includes(capability);
    },
    childHeading(): string {
      return this.hub && this.hub.type === "colony"
        ? "Neighborhoods in this colony"
        : "Blocks in this neighborhood";
    },
    emptyChildMessage(): string {
      return this.hub && this.hub.type === "colony"
        ? "This colony has no neighborhoods."
        : "This neighborhood has no blocks.";
    },
  },
  methods: {
    childRoute(child: { id: number }): Record<string, unknown> {
      return this.hub.type === "colony"
        ? { name: "neighborhoodpage", params: { id: String(child.id) } }
        : { name: "blockmap", params: { id: String(child.id) } };
    },
    targetFor(tile: any): Record<string, unknown> {
      return tileRoute(tile, this.context) || {};
    },
    hrefFor(tile: any): string {
      return tileHref(tile, this.context);
    },
    openWindow(event: Event, tile: any): void {
      // The href stays on the anchor so the target is inspectable and the link
      // degrades sensibly; the click opens the classic popup instead of
      // navigating, matching the existing tool bars.
      event.preventDefault();
      window.open(
        tileHref(tile, this.context),
        "targetWindow",
        "height=650,width=800,menubar=no,status=no",
      );
    },
    async getChildren(): Promise<void> {
      try {
        if (this.hub.type === "colony" && this.hub.slug) {
          const response = await this.$http.get(`/colony/${this.hub.slug}/hoods`);
          this.children = response.data.hoods || [];
        } else if (this.hub.type === "hood") {
          const response = await this.$http.get(`/hood/${this.hub.placeId}/blocks`);
          this.children = response.data.blocks || [];
        }
      } catch (e) {
        // A failed child listing must not present as a refusal - the hub itself
        // was authorized. Show the tools and an empty list.
        this.children = [];
      }
    },
    async getData(): Promise<void> {
      try {
        const response = await this.$http.get(`/place/${this.placeId}/update-hub`);
        const hub = response.data.hub;
        // `canOpen` is narrower than "the endpoint answered 200": the server
        // grants it only when a capability whose control lives IN the hub was
        // granted. A member holding just tool-bar or moderation capabilities has
        // no wizard to open, and is refused rather than shown an empty page.
        if (!hub || hub.type !== this.expectedType || hub.canOpen !== true) {
          this.denied = true;
          return;
        }
        this.hub = hub;
        if (this.showsChildren) {
          await this.getChildren();
        }
      } catch (e) {
        this.denied = true;
      } finally {
        this.loaded = true;
      }
    },
    back(): void {
      this.$router.back();
    },
  },
  mounted(): void {
    this.getData();
  },
});
</script>
