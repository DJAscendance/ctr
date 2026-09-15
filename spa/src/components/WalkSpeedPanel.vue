<template>
  <div
    v-show="visible"
    ref="panel"
    class="fixed flex-none text-black bg-gray-300 cls-walk-speed-panel"
    style="border: outset #EEE; padding: 0.25rem; z-index: 30;"
    :style="{ left: left + 'px', top: top + 'px' }"
  >
    <div class="flex items-center" style="gap: 0.25rem;">
      <strong style="font-size: 0.8rem;">Walk Speed</strong>
      <button
        type="button"
        class="cls-walk-speed-close"
        style="margin-left: auto; border: outset #EEE; padding: 0 0.3rem;"
        title="Close"
        @click="$emit('close')"
      >x</button>
    </div>
    <div class="flex items-center" style="gap: 0.25rem; margin-top: 0.25rem;">
      <input
        id="movement-speed"
        type="range"
        aria-label="Walk speed multiplier"
        :min="speedMin"
        :max="speedMax"
        step="0.1"
        :value="movementSpeed"
        @input="onSpeedInput"
      />
      <input
        id="movement-speed-number"
        type="number"
        aria-label="Walk speed multiplier value"
        :min="speedMin"
        :max="speedMax"
        step="0.1"
        style="width: 4em;"
        :value="movementSpeed"
        @change="onSpeedCommit"
      />
      <span
        class="cls-walk-speed-readout"
        style="min-width: 2.5em; display: inline-block;"
      >{{ movementSpeed.toFixed(1) }}x</span>
      <button type="button" class="btn-ui cls-walk-speed-reset" @click="resetSpeed">Reset</button>
    </div>
  </div>
</template>

<script lang="ts">
/*
 * The walk-speed control, opened from the "Walk Speed" entry this application
 * adds to X_ITE's own world context menu (see WorldBrowserPage.installWalkSpeedMenu).
 *
 * It deliberately owns NO speed of its own. The slider, the number box and
 * Reset all hand their raw value to the one store setter, which clamps it
 * before it reaches state, localStorage or the viewer, so the three controls
 * cannot drift apart and a value edited straight into storage cannot escape
 * the supported range either.
 *
 * Styling copies UserMenu.vue - gray-300 on an outset #EEE border - because
 * that is the look the rest of the reconstructed Cybertown chrome already uses.
 *
 * Positioned `fixed`, in viewport coordinates, on purpose. The obvious
 * alternative - `absolute` against a `relative` WorldBrowserPage root - would
 * make that root the containing block for every absolutely positioned
 * descendant of the page, and Chat.vue's UserMenu is one of them: it sets
 * left/top from raw cursorX/cursorY and today resolves against the viewport,
 * so it would have jumped by the page root's own offset. `fixed` adds no
 * containing block anywhere and leaves that menu exactly where it was.
 */
import { defineComponent } from "vue";
import {
  DEFAULT_MOVEMENT_SPEED_MULTIPLIER,
  formatSpeedInput,
  MAX_MOVEMENT_SPEED_MULTIPLIER,
  MIN_MOVEMENT_SPEED_MULTIPLIER,
} from "@/helpers/movement-speed.helper";

export default defineComponent({
  name: "WalkSpeedPanel",
  props: {
    visible: { type: Boolean, default: false },
    left: { type: Number, default: 0 },
    top: { type: Number, default: 0 },
  },
  data() {
    return {
      speedMin: MIN_MOVEMENT_SPEED_MULTIPLIER,
      speedMax: MAX_MOVEMENT_SPEED_MULTIPLIER,
    };
  },
  computed: {
    movementSpeed(): number {
      return this.$store.data.movementSpeedMultiplier;
    },
  },
  methods: {
    onSpeedInput(event: Event): void {
      const target = event.target as HTMLInputElement;
      this.$store.methods.setMovementSpeedMultiplier(target.value);
    },
    /*
     * The number box commits on `change` (Enter, blur, spinner) rather than on
     * `input`, so a half-typed "0." is not clamped up to the minimum under the
     * citizen's fingers. The write-back matters when the clamp lands back on
     * the value already held - "abc" in a box showing 2.5 leaves the store
     * untouched, so Vue has nothing to re-render and the box would stay empty.
     */
    onSpeedCommit(event: Event): void {
      const target = event.target as HTMLInputElement;
      this.$store.methods.setMovementSpeedMultiplier(target.value);
      target.value = formatSpeedInput(this.movementSpeed);
    },
    resetSpeed(): void {
      this.$store.methods.setMovementSpeedMultiplier(DEFAULT_MOVEMENT_SPEED_MULTIPLIER);
    },
    /*
     * Dismissal on a click anywhere that is not the panel. Bound on the
     * document only while the panel is open, so a closed panel costs nothing
     * and cannot swallow a world click. `mousedown` rather than `click`
     * matches how X_ITE's own menu layer dismisses itself.
     */
    onDocumentMouseDown(event: MouseEvent): void {
      const panel = this.$refs.panel as HTMLElement;
      if (panel && event.target instanceof Node && panel.contains(event.target)) return;
      this.$emit("close");
    },
    onDocumentKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape" || event.key === "Esc") this.$emit("close");
    },
    bindDismissal(): void {
      document.addEventListener("mousedown", this.onDocumentMouseDown, true);
      document.addEventListener("keydown", this.onDocumentKeyDown, true);
    },
    unbindDismissal(): void {
      document.removeEventListener("mousedown", this.onDocumentMouseDown, true);
      document.removeEventListener("keydown", this.onDocumentKeyDown, true);
    },
  },
  watch: {
    visible(open: boolean): void {
      if (open) this.bindDismissal();
      else this.unbindDismissal();
    },
  },
  mounted(): void {
    if (this.visible) this.bindDismissal();
  },
  /* A route change unmounts the page, so the listeners must go with it. */
  beforeUnmount(): void {
    this.unbindDismissal();
  },
});
</script>
