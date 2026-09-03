<!--
  OUTLANDS-2B - the Outlands Chief's match-password panel.

  THE HISTORICAL THING THIS REPLACES. `ne_game/passupdate.tmpl`, a two-field form
  reached from the Outlands control panel, labelled exactly:

      Blue Team Password   <input name="PASS1">
      Red Team Password    <input name="PASS2">

  The classic form pre-filled both boxes with the live values, because the
  classic server stored them in plaintext. This one cannot and does not. It is
  told only whether each password is SET, never what it is, so there is no
  read-back path to leak - see `outlands-match.service.ts`.

  WHAT IT IS NOT. It is not an Outlands dashboard. Match passwords are the only
  thing it touches, and the Game Master, team 3 and scoring appear nowhere in it.
  Those are OUTLANDS-2C and OUTLANDS-2D.

  WHO SEES IT. Nobody, unless the API says so. The panel asks the server whether
  the member may administer matches and renders nothing at all otherwise, and the
  server enforces the same rule again on the write - the hidden panel is a
  courtesy, not the check.
-->
<template>
  <div v-if="canManage" class="mt-8 p-3 outlands-match-admin" data-outlands-match-admin>
    <h3 class="font-bold text-center">Scheduled match passwords</h3>

    <p class="mt-1 text-sm text-center">
      Blue Team is {{ blueSet ? "set" : "not set" }}.
      Red Team is {{ redSet ? "set" : "not set" }}.
    </p>
    <p class="mt-1 text-xs text-center">
      A stored password is never shown again. Leave a box empty to keep that
      team's password as it is.
    </p>

    <div class="mt-3 flex flex-wrap justify-center items-end">
      <div class="p-2">
        <label for="outlands-blue-password" class="block text-sm">Blue Team Password</label>
        <input
          id="outlands-blue-password"
          v-model="blue"
          data-outlands-blue-password
          type="password"
          maxlength="128"
          autocomplete="new-password"
          class="mt-1 px-2 py-1 text-black"
          :disabled="busy"
        />
      </div>
      <div class="p-2">
        <label for="outlands-red-password" class="block text-sm">Red Team Password</label>
        <input
          id="outlands-red-password"
          v-model="red"
          data-outlands-red-password
          type="password"
          maxlength="128"
          autocomplete="new-password"
          class="mt-1 px-2 py-1 text-black"
          :disabled="busy"
        />
      </div>
      <div class="p-2">
        <button
          type="button"
          class="px-3 py-1 border"
          data-outlands-save-passwords
          :disabled="busy || !hasEntry"
          @click="save"
        >
          UPDATE
        </button>
      </div>
      <div class="p-2">
        <button
          type="button"
          class="px-3 py-1 border"
          data-outlands-clear-passwords
          :disabled="busy || (!blueSet && !redSet)"
          @click="clearBoth"
        >
          Stand down match
        </button>
      </div>
    </div>

    <p v-if="message" class="mt-2 text-center text-sm" data-outlands-match-admin-message>
      {{ message }}
    </p>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

export default Vue.extend({
  name: "OutlandsMatchAdmin",
  data: () => {
    return {
      /** Set only by a 200 from the server. Never inferred from a role locally. */
      canManage: false,
      blueSet: false,
      redSet: false,
      /* Typed replacements. Cleared the moment they are sent. */
      blue: "",
      red: "",
      busy: false,
      message: "",
    };
  },
  computed: {
    /** Is there anything to send? An empty box means "leave that team alone". */
    hasEntry(): boolean {
      return this.blue !== "" || this.red !== "";
    },
  },
  async mounted(): Promise<void> {
    await this.refresh();
  },
  methods: {
    /**
     * Ask the server whether this member may administer matches, and if so which
     * teams have a password. A refusal is silent: the panel simply stays hidden,
     * so an ordinary member is never told the feature exists.
     */
    async refresh(): Promise<void> {
      try {
        const response = await this.$http.get("/outlands/match/passwords");
        const data = response && response.data ? response.data : {};
        this.canManage = true;
        this.blueSet = data.blueSet === true;
        this.redSet = data.redSet === true;
      } catch (error) {
        this.canManage = false;
        this.blueSet = false;
        this.redSet = false;
      }
    },

    /**
     * Send the typed replacements. Only a box that was actually filled in is
     * sent, so saving one team's password never silently clears the other's.
     */
    async save(): Promise<void> {
      if (this.busy || !this.hasEntry) { return; }
      const body: { blue?: string; red?: string } = {};
      if (this.blue !== "") { body.blue = this.blue; }
      if (this.red !== "") { body.red = this.red; }
      await this.send(body, "Match passwords updated.");
    },

    /**
     * Clear both passwords, which is how a scheduled match is stood down. After
     * this no password is accepted and Outlands is free play only.
     */
    async clearBoth(): Promise<void> {
      if (this.busy) { return; }
      await this.send({ blue: null, red: null }, "Scheduled match stood down.");
    },

    /** The one write path. Drops the typed values as soon as they are sent. */
    async send(body: any, done: string): Promise<void> {
      this.busy = true;
      this.message = "";
      try {
        await this.$http.put("/outlands/match/passwords", body);
        this.message = done;
        await this.refresh();
      } catch (error) {
        // Never the server's error text, which is a needless second channel.
        this.message = "That change could not be saved.";
      } finally {
        this.blue = "";
        this.red = "";
        this.busy = false;
      }
    },
  },
});
</script>

<style scoped>
  .outlands-match-admin {
    border: 1px solid #888888;
  }
</style>
