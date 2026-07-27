<template>
  <div class="h-full w-full bg-black flex flex-col p-2" v-if="loaded">
    <template v-if="denied">
      <p class="text-center text-red-500">Insufficient access rights.</p>
      <p class="text-center">
        <button type="button" class="btn" @click="back">Back</button>
      </p>
    </template>

    <template v-else>
      <div class="text-center mb-3">
        <p><strong>Update Wizard for {{ hub.name }}</strong></p>
        <small>Only the tools you may use are shown.</small>
      </div>

      <!--
        The tool list comes from the catalogue in helpers/place-update-hub.helper,
        filtered by the capabilities the SERVER granted. Colony, Neighborhood and
        Block all render through this one component so they cannot drift apart.

        Nothing here is an access control. Every route and popup below is
        independently authorized by its own endpoint; this only decides what to
        draw.
      -->
      <div
        class="grid gap-2 justify-center"
        style="grid-template-columns: repeat(auto-fit, minmax(11rem, 14rem))"
        data-testid="update-hub-tiles"
      >
        <router-link
          v-for="tile in routeTiles"
          :key="tile.key"
          :to="targetFor(tile)"
          :data-capability="tile.key"
          class="block border border-green-700 p-2 text-center no-underline hover:border-green-400"
        >
          <span class="block font-bold">{{ tile.label }}</span>
          <small class="block">{{ tile.description }}</small>
        </router-link>
        <a
          v-for="tile in windowTiles"
          :key="tile.key"
          :href="hrefFor(tile)"
          :data-capability="tile.key"
          class="block border border-green-700 p-2 text-center no-underline hover:border-green-400"
          @click="openWindow($event, tile)"
        >
          <span class="block font-bold">{{ tile.label }}</span>
          <small class="block">{{ tile.description }}</small>
        </a>
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
    routeTiles(): any[] {
      return this.tiles.filter((tile) => tile.kind === "route");
    },
    windowTiles(): any[] {
      return this.tiles.filter((tile) => tile.kind === "window");
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
        if (!hub || hub.type !== this.expectedType) {
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
