<template>
  <div class="inline-block mx-auto">
    <div
      :style="mapStyle"
      class="grid grid-cols-12 gap-0"
      role="group"
      :aria-label="ariaLabel"
    >
      <div
        v-for="location in lotCount"
        :key="location"
        :style="cellStyle"
      >
        <!--
          Scoped slot: consumers decide what a lot looks like, this component owns
          WHERE it is. `lot` is the matching entry from `locations` or null.
        -->
        <slot
          name="lot"
          :location="location"
          :lot="lotAt(location)"
          :row="rowColumn(location).row"
          :column="rowColumn(location).column"
        ></slot>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

import {
  BLOCK_MAP_CELL_SIZE,
  BLOCK_MAP_HEIGHT,
  BLOCK_MAP_LOT_COUNT,
  BLOCK_MAP_WIDTH,
  locationToRowColumn,
} from "@/helpers";

/**
 * The one authoritative block lot grid.
 *
 * Renders the 480x240 block background with a transparent 12 x 6 grid of 40x40
 * lot cells over it - the original Cybertown geometry, recovered from the
 * blaxxun CS 4.0 templates and archived production art (see
 * docs/research/classic-place-admin-re-evidence.md §3.2, and the constants in
 * @/helpers/block-map.helper.ts).
 *
 * This component deliberately renders NO lot content of its own. The ordinary
 * block map, the block update wizard and the background preview each supply
 * their own cell markup through the `lot` scoped slot, so they can differ in
 * interaction while being physically incapable of disagreeing about where a lot
 * is. That mirrors how the original worked: block/wizard/place.tmpl and
 * block/place.tmpl declared byte-identical frame geometry and the wizard simply
 * substituted checkboxes for free lots.
 */
export default Vue.extend({
  name: "BlockLotMap",
  props: {
    /**
     * Lot occupancy, as returned by GET /block/:id/locations. Entries carry at
     * least `location` (1-based, row-major); occupied lots also carry `id`,
     * `name`, `username` and `map_icon_index`.
     */
    locations: {
      type: Array,
      default: (): unknown[] => [],
    },
    /** CSS background-image value. Build it with blockBackgroundStyle(). */
    background: {
      type: String,
      required: true,
    },
    /** Accessible name for the grid as a whole. */
    ariaLabel: {
      type: String,
      default: "Block map",
    },
  },
  data() {
    return {
      lotCount: BLOCK_MAP_LOT_COUNT,
    };
  },
  computed: {
    mapStyle(): object {
      return {
        width: `${BLOCK_MAP_WIDTH}px`,
        height: `${BLOCK_MAP_HEIGHT}px`,
        "background-image": this.background,
      };
    },
    cellStyle(): object {
      return {
        height: `${BLOCK_MAP_CELL_SIZE}px`,
      };
    },
    /**
     * location -> lot, built once per `locations` change. The pages this
     * replaces called `locations.find(...)` up to five times per cell (360 scans
     * per render); this is the same answer without that.
     */
    lotsByLocation(): Record<number, unknown> {
      const byLocation: Record<number, unknown> = {};
      (this.locations as Array<{ location: number }>).forEach(lot => {
        byLocation[lot.location] = lot;
      });
      return byLocation;
    },
  },
  methods: {
    lotAt(location: number): unknown {
      return this.lotsByLocation[location] || null;
    },
    rowColumn(location: number): { row: number; column: number } {
      return locationToRowColumn(location);
    },
  },
});
</script>
