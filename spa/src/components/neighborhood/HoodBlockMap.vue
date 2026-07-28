<template>
  <div class="inline-block mx-auto">
    <div
      :style="mapStyle"
      class="grid grid-cols-6 gap-0"
      role="group"
      :aria-label="ariaLabel"
    >
      <div
        v-for="location in blockCount"
        :key="location"
        :style="cellStyle"
      >
        <!--
          Scoped slot: consumers decide what a block position looks like, this
          component owns WHERE it is. `block` is the matching entry from `blocks`
          or null.
        -->
        <slot
          name="block"
          :location="location"
          :block="blockAt(location)"
          :icon="blockIcon"
        ></slot>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

import {
  HOOD_MAP_BLOCK_COUNT,
  HOOD_MAP_CELL_HEIGHT,
  HOOD_MAP_HEIGHT,
  HOOD_MAP_INSET,
  HOOD_MAP_WIDTH,
  hoodBlockIconStyle,
} from "@/helpers";

/**
 * The one authoritative neighborhood block grid.
 *
 * The neighborhood counterpart of BlockLotMap: it renders the 540x300
 * neighborhood background with a transparent 6 x 5 grid of block positions over
 * it, and nothing else. The ordinary neighborhood map and the background
 * chooser's preview each supply their own cell markup through the `block` scoped
 * slot, so they can differ in interaction while being physically incapable of
 * disagreeing about where a block is.
 *
 * That distinction is the entire point of extracting this. The background
 * chooser previously previewed a candidate as a bare <img>, with no blocks drawn
 * over it at all, so a leader could not tell whether a candidate put a river
 * under an existing block before committing to it. Sharing the renderer means the
 * preview shows the real map - current block names and current mini-city icons in
 * their real positions - rather than an approximation of it.
 *
 * Geometry lives in @/helpers/hood-map.helper.ts. This component renders block
 * positions only; it neither creates, renames nor moves a block.
 */
export default Vue.extend({
  name: "HoodBlockMap",
  props: {
    /**
     * Blocks in this neighborhood, as returned by GET /hood/:id/blocks. Entries
     * carry at least `location` (1-based, row-major), `id` and `name`.
     */
    blocks: {
      type: Array,
      default: (): unknown[] => [],
    },
    /** CSS background-image value. Build it with hoodBackgroundStyle(). */
    background: {
      type: String,
      required: true,
    },
    /** Map theme, used to resolve the block mini-city icon. */
    theme: {
      type: String,
      default: "",
    },
    /** Accessible name for the grid as a whole. */
    ariaLabel: {
      type: String,
      default: "Neighborhood map",
    },
  },
  data() {
    return {
      blockCount: HOOD_MAP_BLOCK_COUNT,
    };
  },
  computed: {
    mapStyle(): object {
      return {
        padding: HOOD_MAP_INSET,
        width: `${HOOD_MAP_WIDTH}px`,
        height: `${HOOD_MAP_HEIGHT}px`,
        "background-image": this.background,
      };
    },
    cellStyle(): object {
      return {
        height: `${HOOD_MAP_CELL_HEIGHT}px`,
      };
    },
    /** CSS background-image for an occupied block cell's mini-city icon. */
    blockIcon(): string {
      return this.theme ? hoodBlockIconStyle(this.theme) : "";
    },
    /**
     * location -> block, built once per `blocks` change, so a cell lookup is not
     * a linear scan repeated 30 times per render.
     */
    blocksByLocation(): Record<number, unknown> {
      const byLocation: Record<number, unknown> = {};
      (this.blocks as Array<{ location: number }>).forEach(block => {
        byLocation[block.location] = block;
      });
      return byLocation;
    },
  },
  methods: {
    blockAt(location: number): unknown {
      return this.blocksByLocation[location] || null;
    },
  },
});
</script>
