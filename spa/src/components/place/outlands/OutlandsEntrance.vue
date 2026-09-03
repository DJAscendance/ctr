<!--
  OUTLANDS-2A - the free-play Outlands entrance.

  This restores the historical FUNCTION of `ne_game/enter.tmpl`, recovered as
  `place_files/edit.html` in
  `.reports/ivn-recovery/2026-09-03-outlands-entry-0/`. It deliberately does NOT
  restore the 1999 shell: no Internet Explorer frameset, no blaxxun Contact
  object, no separate 2D chat room. The historical page had none of those as
  content - they were the browser around it.

  The art is the recovered art. All five pictures already ship inside CTR at
  `assets/worlds/ne_game/html/` and are byte-identical to the recovered
  evidence, so this lane adds no asset file.

  The prose is the recovered prose, transcribed from `edit.html` with the 1999
  markup removed and nothing rewritten. Where the recovered instructions and the
  shipped world disagree - the beamer ammunition count is the known case - the
  recovered text is reproduced as written and the conflict is left for a later
  lane. See the note beside the ammunition list.

  OUTLANDS-2B ADDS THE `T_pass` BOX. It is the historical widget in the
  historical place, under the historical label, and it is optional exactly as it
  was: leaving it blank is free play. Typing something in it changes what the
  four tiles MEAN - `setStyle()` collapsed 3 to 1 and 4 to 2, so the colour was
  thrown away and only the sex survived - and the note that appears beside them
  says so, because a coloured picture that no longer picks a colour would
  otherwise mislead.

  OUT OF SCOPE HERE. Game Master entry never appeared on this page at all - it
  was an owner-only control panel link - and is OUTLANDS-2C. Scoring is
  OUTLANDS-2D.
-->
<template>
  <div class="w-full h-full overflow-y-auto bg-black text-white outlands-entrance">
    <div class="max-w-4xl mx-auto p-4">

      <div class="text-center">
        <img :src="headerImage" alt="Outlands" class="inline-block max-w-full" />
      </div>

      <p class="mt-4">
        Cybertown citizens have long held the belief that violent conflict benefits
        no one. However, when diplomacy fails, a means for arguing factions to settle
        their differences is still occasionaly required. Outlands has been created to
        help Cybertown citizens settle disputes, without descending to the brutal
        devices of our ancestors, through honorable combat using non lethal beam-out
        weapons.
      </p>

      <p class="mt-2">
        All Citizens who enter this zone are required to take sides and face the
        prospect of beam-out. If you are new to Outlands take time to read the
        instructions below before you enter the fray.
      </p>

      <h2 class="mt-6 text-lg font-bold text-center">
        Select an avatar to enter Outlands
      </h2>

      <p v-if="!canEnter" class="mt-2 text-center" style="color: #ff6666;">
        Sorry, only Cybertown Citizens can enter Outlands.
      </p>

      <!--
        OUTLANDS-2B. The historical `T_pass` box, `enter.tmpl` line 65. Optional:
        blank is free play. `autocomplete="off"` keeps the browser from offering
        to remember a match password, which is the only long-lived store it could
        otherwise reach.
      -->
      <div class="mt-4 text-center">
        <label for="outlands-match-password" class="block text-sm">
          {{ matchPrompt }}
        </label>
        <input
          id="outlands-match-password"
          ref="matchPassword"
          v-model="password"
          data-outlands-match-password
          type="password"
          size="10"
          maxlength="128"
          autocomplete="off"
          class="mt-1 px-2 py-1 text-black"
          :disabled="!canEnter || busy"
        />
      </div>

      <!--
        OUTLANDS-2B. Shown only while a password is typed, because that is
        exactly when the four coloured pictures stop meaning what they look like.
      -->
      <p
        v-if="matchMode"
        class="mt-3 text-center"
        data-outlands-match-note
        style="color: #ffcc33;"
      >
        Scheduled match. Your team colour comes from your match password.
        The avatar you pick chooses male or female only.
      </p>

      <p
        v-if="error"
        class="mt-3 text-center"
        data-outlands-match-error
        style="color: #ff6666;"
      >
        {{ error }}
      </p>

      <div class="mt-3 flex flex-wrap justify-center">
        <div v-for="entry in avatars" :key="entry.key" class="p-2 text-center">
          <a
            href="#"
            :title="tileLabel(entry)"
            @click.prevent="choose(entry.key)"
          >
            <img
              :src="entry.thumbnailUrl"
              :alt="tileLabel(entry)"
              :class="tileClass(entry)"
            />
          </a>
          <div
            class="mt-1"
            :data-outlands-avatar="entry.key"
            :data-outlands-sex="entry.sex.toLowerCase()"
          >
            {{ tileLabel(entry) }}
          </div>
        </div>
      </div>

      <!--
        OUTLANDS-2B. The modern `ne_game/passupdate.tmpl`. It renders nothing at
        all unless the server confirms the viewer may administer matches, so an
        ordinary member never learns it is here.
      -->
      <outlands-match-admin></outlands-match-admin>

      <h2 class="mt-8 text-lg font-bold text-center">Instructions</h2>

      <h3 class="mt-4 font-bold">Entering The Zone</h3>
      <p class="mt-1">
        Select a special avatar for the battle. After you have selected an avatar,
        you will be able to enter Outlands and join the battle.
      </p>
      <p class="mt-1">
        <strong>WARNING:</strong> You must use one of the special avatars during the
        battle. Changing your avatar will cause you to beam out.
      </p>

      <h3 class="mt-4 font-bold">Controls</h3>
      <p class="mt-1">
        During the battle you will navigate the battle field using the mouse or arrow
        keys, just like you do anywhere in Virtual Space. You have several special
        keyboard controls that will help you aim and fire your weapon.
      </p>
      <p class="mt-1">
        <strong>DO NOT</strong> use the Navigation Panel to navigate. Using the
        Navigation Panel will disable the keyboard controls. If this happens, click
        the 3D screen to re-enable the keyboard.
      </p>
      <ul class="mt-1 list-disc list-inside">
        <li>The <strong>D</strong> key fires your weapon</li>
        <li>The <strong>A</strong> key allows you to pan your view, and aim up hills</li>
        <li>The <strong>W</strong> key will change your weapon</li>
      </ul>

      <h3 class="mt-4 font-bold">Scoring</h3>
      <ul class="mt-1 list-disc list-inside">
        <li>Scoring is team based.</li>
        <li>Each beam-out will score one point for your team.</li>
        <li>
          During planned matches, the team with the most beam-outs at the end of the
          scheduled battle time will claim victory.
        </li>
        <li>During Free Play periods, team score will keep accumulating.</li>
      </ul>
      <p class="mt-1">
        Since your beam to function is currently engaged to enable your weapon, using
        beaming to another player will beam you out of the battle and score a point
        for the opposition.
      </p>

      <h3 class="mt-4 font-bold">Beam-out Weapons</h3>
      <p class="mt-1">
        <strong>Beamer.</strong> The beamer is a line-of-sight weapon. It fires a ball
        of beam energy at your target. If it hits, the target is beamed out.
      </p>
      <p class="mt-1">
        <strong>Repulsor.</strong> The repulsor generates a force wave by harnessing
        your beam energy. When fired, the force wave generated by the repulsor sends
        all opponents in front of the shooter, spinning away.
      </p>
      <p class="mt-1">
        <strong>AaPD2000.</strong> The AaPD2000 is a stink bomb launcher. It explodes
        upon impact leaving a green gas cloud in a 10 meter radius. The smell is so
        unbearable that anyone standing within the perimeter at the moment of impact
        will be forced to beam out.
      </p>

      <h3 class="mt-4 font-bold">Ammunition</h3>
      <p class="mt-1">
        All beam-out weapons carry only a limited supply of ammunition. Once you use
        all of your ammunition, you will need to return to a base and obtain more
        ammunition.
      </p>
      <!--
        The three counts below are the recovered 1999 help text, word for word.
        The shipped world's own weapon data is the other authority and the two
        are known to disagree on the beamer. That conflict is recorded, not
        resolved, and is out of scope for OUTLANDS-2A.
      -->
      <ul class="mt-1 list-disc list-inside">
        <li>Beamers carry 10 shots</li>
        <li>Repulsors carry 7 shots</li>
        <li>AaPD2000's carry 4 shots</li>
      </ul>
      <p class="mt-1">
        You will need to find the correct ammo for the weapon you carry. To get ammo
        navigate over the proper ammo and your weapon will be re-loaded.
      </p>

      <h3 class="mt-4 font-bold">Bases</h3>
      <p class="mt-1">Your team's base serves several functions.</p>

      <h3 class="mt-4 font-bold">Beamer Cannons</h3>
      <p class="mt-1">
        The beamer cannons on your bases are Model BC355 Anti-Grav cannon pods. The
        anti-gravity base allows great maneuverability during battle, but makes the
        controls very sensitive.
      </p>
      <p class="mt-1">
        To enter a cannon, click the cannon and you will be placed in the cockpit. To
        aim the cannon, click on the screen, and move your mouse to rotate the cannon.
      </p>
      <p class="mt-1">
        <strong>TIP:</strong> Controlling the beamer cannon can be a little tricky.
        Try to use small mouse movements to control, and use the stabilizer key
        frequently to keep your aim on target.
      </p>
      <p class="mt-1">You can fire and stabilize the cannon with the keyboard:</p>
      <ul class="mt-1 list-disc list-inside">
        <li>The <strong>D</strong> key fires the cannon</li>
        <li>
          The <strong>A</strong> key engages the stabilizer.
          (Use this if you lose control of the cannon)
        </li>
        <li>The <strong>W</strong> key is disabled when you control a cannon.</li>
      </ul>

    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

import OutlandsMatchAdmin from "@/components/place/outlands/OutlandsMatchAdmin.vue";
import {
  OUTLANDS_AVATARS,
  OUTLANDS_HEADER_IMAGE,
  OUTLANDS_MATCH_PROMPT,
  OutlandsAvatar,
} from "@/helpers/outlands.helper";

export default Vue.extend({
  name: "OutlandsEntrance",
  components: { OutlandsMatchAdmin },
  props: {
    /**
     * The modern stand-in for the historical `#ifdef isVisitor` refusal. False
     * hides nothing - the historical page was readable by a visitor - but the
     * picker refuses to act, exactly as `enter.tmpl`'s alert did.
     */
    canEnter: {
      type: Boolean,
      default: false,
    },
    /**
     * OUTLANDS-2B. The one generic refusal a rejected match password produces.
     * It is passed in rather than decided here, because the decision is the
     * server's; the entrance only shows what it is told.
     */
    error: {
      type: String,
      default: "",
    },
    /** OUTLANDS-2B. True while a match password is being checked. */
    busy: {
      type: Boolean,
      default: false,
    },
  },
  data: () => {
    return {
      avatars: OUTLANDS_AVATARS,
      headerImage: OUTLANDS_HEADER_IMAGE,
      matchPrompt: OUTLANDS_MATCH_PROMPT,
      /*
       * OUTLANDS-2B. The typed `T_pass`. It lives here for the life of this
       * component and nowhere else: it is never put in `localStorage`,
       * `sessionStorage`, a cookie, the URL or the app store, so a page refresh
       * destroys it and a scheduled match has to be re-entered. That is the
       * accepted behaviour, and it is the safest one.
       *
       * The page hides the entrance with `v-if` the moment a match is accepted,
       * which destroys this component and this field with it, so the plaintext
       * does not survive into the world.
       */
      password: "",
    };
  },
  computed: {
    /** Is a scheduled match being attempted? `setStyle()`'s empty-vs-not test. */
    matchMode(): boolean {
      return this.password !== "";
    },
  },
  methods: {
    /**
     * What the tile says. In free play the colour is the team, so the historical
     * "Red male" label stands. In a match the password owns the colour and the
     * tile owns only the sex, so the caption drops the colour rather than
     * claiming something the entry will not honour.
     */
    tileLabel(entry: OutlandsAvatar): string {
      return this.matchMode ? entry.sex : entry.label;
    },
    tileClass(entry: OutlandsAvatar): string {
      if (this.matchMode) { return "outlands-tile outlands-tile-match"; }
      const border = entry.team === 1 ? "outlands-tile-red" : "outlands-tile-blue";
      return `outlands-tile ${border}`;
    },
    choose(key: string): void {
      if (!this.canEnter) { return; }
      if (this.busy) { return; }
      // The password goes out with the pick and is not kept anywhere else. A
      // blank one is free play and the page above treats it as OUTLANDS-2A did.
      this.$emit("select", { key: key, password: this.password });
    },
  },
});
</script>

<style scoped>
  .outlands-entrance .outlands-tile {
    border: 2px solid transparent;
    cursor: pointer;
  }
  .outlands-entrance .outlands-tile-red {
    border-color: #cc3333;
  }
  .outlands-entrance .outlands-tile-blue {
    border-color: #3366cc;
  }
  /*
    OUTLANDS-2B. In a scheduled match the picture no longer picks the colour, so
    it does not wear one.
  */
  .outlands-entrance .outlands-tile-match {
    border-color: #888888;
  }
  .outlands-entrance .outlands-tile:hover {
    border-color: #ffffff;
  }
</style>
