<template>
  <div class="outlands-entrance">
    <div class="outlands-entrance__page">

      <!-- Outlands header art and the introductory fiction. -->
      <header class="oe-center">
        <img src="/assets/worlds/ne_game/html/outlands.jpg" alt="Outlands" class="oe-banner" />
        <p>
          Cybertown citizens have long held the belief that and violent conflict benefits no
          one. However, when diplomacy fails, a means for arguing factions to settle their
          differences is still occasionaly required. Outlands has been created to help Cybertown
          citizens settle disputes, without descending to the brutal devices of our ancestors,
          through honorable combat using non lethal beam-out weapons.
        </p>
        <p>
          All Citizens who enter this zone are required to take sides and face the prospect of
          beam-out. If you are new to Outlands take time to read the instructions below before
          you enter the fray.
        </p>
        <p><b>Select an avatar to enter Outlands</b></p>
      </header>

      <!-- The avatar picker and the scheduled-match password field. -->
      <form class="oe-choose" name="choose" @submit.prevent>
        <div class="oe-teams">
          <fieldset v-for="team in teams" :key="team.name" class="oe-team">
            <legend class="oe-hidden">{{ team.name }} Team</legend>
            <button
              v-for="slot in team.slots"
              :key="slot.filename"
              type="button"
              class="oe-avatar"
              :disabled="!available(slot) || busy"
              :aria-label="slot.alt"
              :title="slot.alt"
              @click="choose(slot)"
            >
              <img :src="slot.art" :alt="slot.alt" width="100" height="180" />
            </button>
          </fieldset>
        </div>

        <div class="oe-pass">
          <label for="outlands-pass">
            If you have a scheduled match, enter your password here and select an avatar to enter
          </label>
          <input
            id="outlands-pass"
            v-model="password"
            name="T_pass"
            type="text"
            size="10"
            autocomplete="off"
          />
        </div>

        <p v-if="notice" class="oe-notice" role="status">{{ notice }}</p>
        <p v-if="error" class="oe-error" role="alert">{{ error }}</p>
      </form>

      <!-- Instructions -->
      <h2 class="oe-title">Instructions</h2>
      <hr class="oe-rule-center" />

      <div class="oe-body">
        <h3>Entering The Zone</h3>
        <hr class="oe-rule" />
        <p>
          Select a special avatar for the battle. After you have selected an avatar, you will be
          able to enter Outlands and join the battle.
        </p>
        <p class="oe-warn">
          <b>WARNING</b>: You must use one of the special avatars during the battle. Changing your
          avatar will cause you to beam out.
        </p>

        <h3>Controls</h3>
        <hr class="oe-rule" />
        <p>
          During the battle you will navigate the battle field using the mouse or arrow keys, just
          like you do anywhere in Virtual Space. You have several special keyboard controls that
          will help you aim and fire your weapon.
        </p>
        <p class="oe-warn">
          <b>DO NOT</b> use the Navigation Panel to navigate. Using the Navigation Panel will
          disable the keyboard controls. If this happens, click the 3D screen to re-enable the
          keyboard.
        </p>
        <img
          src="/assets/worlds/ne_game/html/controls_notxt.jpg"
          alt="The D, A and W keys on a keyboard"
          width="260"
          height="135"
        />
        <p>
          The <b class="oe-d">D</b> key fires your weapon<br />
          The <b class="oe-a">A</b> key allows you to pan your view, and aim up hills<br />
          The <b class="oe-w">W</b> key will change your weapon
        </p>

        <h3>Scoring</h3>
        <hr class="oe-rule" />
        <ul>
          <li>Scoring is team based.</li>
          <li>Each beam-out will score one point for your team.</li>
          <li>
            During planned matches, the team with the most beam-outs at the end of the scheduled
            battle time will claim victory.
          </li>
          <li>During Free Play periods, team score will keep accumulating.</li>
        </ul>
        <p class="oe-center oe-warn">
          Since your beam to function is currently engaged to enable your weapon, using beaming to
          another player will beam you out of the battle and score a point for the opposition.
        </p>

        <h3>Beam-out Weapons</h3>
        <hr class="oe-rule" />
        <div v-for="arm in arms" :key="arm.id">
          <p><b><a href="#" @click.prevent="openArm(arm)">{{ arm.name }}</a></b></p>
          <blockquote>{{ arm.blurb }}</blockquote>
        </div>

        <h3>Ammunition</h3>
        <hr class="oe-rule" />
        <p>
          All beam-out weapons carry only a limited supply of ammunition. Once you use all of your
          ammunition, you will need to return to a base and obtain more ammunition.
        </p>
        <ul>
          <li>Beamers carry 10 shots</li>
          <li>Repulsors carry 7 shots</li>
          <li>AaPD2000's carry 4 shots</li>
        </ul>
        <p>
          You will need to find the correct ammo for the weapon you carry. To get ammo navigate
          over the proper ammo and your weapon will be re-loaded.
        </p>
        <div class="oe-ammo">
          <figure>
            <img src="/assets/worlds/ne_game/html/beamer.jpg" alt="" width="46" height="100" />
            <figcaption><b>Beamer Ammo</b></figcaption>
          </figure>
          <figure>
            <img src="/assets/worlds/ne_game/html/repulsor.jpg" alt="" width="70" height="100" />
            <figcaption><b>Repulsor Ammo</b></figcaption>
          </figure>
          <figure>
            <img src="/assets/worlds/ne_game/html/aapd.jpg" alt="" width="82" height="100" />
            <figcaption><b>AaPD2000 ammo</b></figcaption>
          </figure>
        </div>

        <h3>Bases</h3>
        <hr class="oe-rule" />
        <p class="oe-dim">Your team' s base serves several functions.</p>

        <h3>Beamer Cannons</h3>
        <hr class="oe-rule" />
        <div class="oe-cannon">
          <p class="oe-dim">
            The beamer cannons on your bases are Model BC355 Anti-Grav cannon pods. The
            anti-gravity base allows great maneuverability during battle, but makes the controls
            very sensitive.
          </p>
          <img
            src="/assets/worlds/ne_game/html/turret_noman.jpg"
            alt="A Model BC355 Anti-Grav beamer cannon pod"
            width="172"
            height="150"
          />
        </div>
        <p class="oe-dim">
          To enter a cannon, click the cannon and you will be placed in the cockpit. To aim the
          cannon, click on the screen, and move your mouse to rotate the cannon.
        </p>
        <p class="oe-dim">
          <span class="oe-tip">TIP:</span> Controlling the beamer cannon can be a little tricky.
          Try to use small mouse movements to control, and use the stabilizer key frequently to
          keep your aim on target.
        </p>
        <p class="oe-dim">You can fire and stabilize the cannon with the keyboard:</p>
        <img
          src="/assets/worlds/ne_game/html/controls_notxt.jpg"
          alt="The D, A and W keys on a keyboard"
          width="260"
          height="135"
        />
        <p>
          The <b class="oe-d">D</b> key fires the cannon<br />
          The <b class="oe-a">A</b> key engages the stabilizer.<br />
          (Use this if you lose control of the cannon)<br />
          The <b class="oe-w">W</b> key is disabled when you control a cannon.
        </p>
      </div>
    </div>

    <!--
      Weapon information. The historical page opened these through
      `javascript:loadInfo(...)` into the control-panel frame. There is no such
      frame now, so the recovered pages are presented as an information panel.
    -->
    <div v-if="arm" class="oe-info" role="dialog" aria-modal="true" aria-labelledby="oe-info-name">
      <div class="oe-info__box">
        <h3 id="oe-info-name">{{ arm.title }}</h3>
        <img :src="arm.art" :alt="arm.name" />
        <p>{{ arm.copy }}</p>
        <table>
          <tbody>
            <tr><th>ammo</th><th>reload</th></tr>
            <tr><td>{{ arm.ammo }}</td><td>{{ arm.reload }}</td></tr>
          </tbody>
        </table>
        <button type="button" class="btn-ui" @click="arm = null">Close</button>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
/*
 * The historical Outlands entrance.
 *
 * Outlands never used the ordinary Cybertown place page. `place?plc=ne_game`
 * served ne_game/index.tmpl, whose "place" frame was ne_game/enter.tmpl: the
 * banner, the fiction, four special avatars, one optional scheduled-match
 * password box and the full instructions. The 3D world was only loaded after
 * an avatar was picked, and there was no 2D Outlands room and no 2D/3D choice.
 * This component restores that screen. Its structure and wording come from the
 * recovered capture of enter.tmpl's rendered output (`place_files/edit.html` in
 * the OUTLANDS-ENTRY-0 evidence bundle) and its art is the recovered art the
 * repository already serves under /assets/worlds/ne_game/html.
 *
 * Historical wording is kept as it was recovered, including its typographic
 * slips ("that and violent conflict", "occasionaly", "Your team' s base").
 *
 * Implementation status of the copy this page carries:
 *   - the beam-out warning describes the historical rule. Enforcing it, along
 *     with weapons, scoring, matches and the Game Master, belongs to the
 *     Outlands restoration lane and is NOT implemented here;
 *   - the Ammunition list says a Beamer carries 10 shots while the recovered
 *     Beamer information page says 100. Both are historical and both are
 *     reproduced where they were found. The world Script stays the authority.
 *
 * Selecting an avatar is what gives a member a side, because ne_game.wrl reads
 * the side off the avatar that is worn. See @/libs/outlands.
 */
import Vue from "vue";
import {
  OUTLANDS_TEAM_AVATARS,
  RED_TEAM,
  rememberAvatarBeforeOutlands,
} from "@/libs/outlands";

/*
 * The recovered entrance art for each choice, with the alt text the historical
 * page gave it. Kept beside the markup rather than in @/libs/outlands, which
 * carries team and spawn facts the world needs and no presentation.
 */
const ENTRANCE_ART = {
  "redm.wrl": { art: "/assets/worlds/ne_game/html/redm.jpg", alt: "Join the Red Team" },
  "redf.wrl": { art: "/assets/worlds/ne_game/html/redf.jpg", alt: "Join the Red Team" },
  "bluem.wrl": { art: "/assets/worlds/ne_game/html/bluem.jpg", alt: "Join the Blue Team" },
  "bluef.wrl": { art: "/assets/worlds/ne_game/html/bluef.jpg", alt: "Join the Blue Team" },
};

/* The three recovered weapon information pages, under /html/arms. */
const ARMS = [
  {
    id: "beamer",
    blurb: "The beamer is a line-of-sight weapon. It fires a ball of beam energy at your "
      + "target. If it hits, the target is beamed out.",
    name: "Beamer",
    title: "BEAMER",
    art: "/assets/worlds/ne_game/html/arms/beamer.jpg",
    ammo: "100",
    reload: "0.1 seconds",
    copy: "Any opponent fired upon by a BEAMER is not harmed but simply \"beamed\" out of "
      + "Outlands. Most effective as a strafing or long distance weapon.",
  },
  {
    id: "repulsor",
    blurb: "The repulsor generates a force wave by harnessing your beam energy. When fired, "
      + "the force wave generated by the repulsor sends all opponents in front of the "
      + "shooter, spinning away.",
    name: "Repulsor",
    title: "REPULSOR",
    art: "/assets/worlds/ne_game/html/arms/repulsor.jpg",
    ammo: "7",
    reload: "2 seconds",
    copy: "A very annoying weapon, the REPULSOR pushes opponents spinning far back from the "
      + "attacker. Effective for team play.",
  },
  {
    id: "aapd",
    blurb: "The AaPD2000 is a stink bomb launcher. It explodes upon impact leaving a green "
      + "gas cloud in a 10 meter radius. The smell is so unbearable that anyone standing "
      + "within the perimeter at the moment of impact will be forced to beam out.",
    name: "AaPD2000",
    title: "AAPD - 2000 (Aromatic Anti-personnel Device)",
    art: "/assets/worlds/ne_game/html/arms/aapd2000.jpg",
    ammo: "4",
    reload: "5 seconds",
    copy: "Another very annoying weapon, the AAPD-2000 is a stink bomb launcher. It explodes "
      + "upon impact leaving a green gas cloud in a 10 meter radius. The smell is so unbearable "
      + "that anyone standing within the perimeter at the moment of impact will be forced to "
      + "beam out.",
  },
];

export default Vue.extend({
  name: "OutlandsEntrance",
  data() {
    return {
      /** Avatar records from /avatar, keyed by file name. */
      library: {},
      password: "",
      notice: "",
      error: "",
      busy: false,
      arm: null,
      arms: ARMS,
    };
  },
  computed: {
    /*
     * The four choices in their historical order and grouping: the Red pair in
     * the left cell of enter.tmpl's table, the Blue pair in the right.
     */
    teams(): any[] {
      const slots = OUTLANDS_TEAM_AVATARS.map(entry => Object.assign(
        {}, entry, ENTRANCE_ART[entry.filename],
      ));
      return [
        { name: "Red", slots: slots.filter(slot => slot.team === RED_TEAM) },
        { name: "Blue", slots: slots.filter(slot => slot.team !== RED_TEAM) },
      ];
    },
  },
  methods: {
    /** A choice can only be taken when the avatar library actually serves it. */
    available(slot): boolean {
      return !!this.library[slot.filename];
    },
    openArm(arm): void {
      this.arm = arm;
    },
    async choose(slot): Promise<void> {
      this.notice = "";
      this.error = "";

      /*
       * The historical citizenship gate. enter.tmpl refused world entry to a
       * visitor while still letting them read the page. Cybertown Revival has
       * no visitor tier - the router sends anyone without a session to the
       * login page before a place ever loads - so the rule is already in
       * force. This repeats it here rather than relying on that alone, and
       * does not introduce a second citizenship model.
       */
      if (!this.$store.data.isUser) {
        this.error = "Sorry, only Cybertown Citizens can enter Outlands";
        return;
      }

      /*
       * The historical field chose between free play and a scheduled match:
       * a password sent the member to "Outlands Match 1" and ne_game_pass.wrl
       * instead of ne_game.wrl. Match mode is not restored yet, so a typed
       * password is refused outright. It must not quietly fall through to free
       * play, and it must not be accepted as though it had been checked.
       */
      if (this.password.trim() !== "") {
        this.notice = "Scheduled matches are not restored yet in Cybertown Revival. "
          + "Clear the password box to enter Free Play.";
        return;
      }

      const avatar = this.library[slot.filename];
      if (!avatar) {
        this.error = "That avatar is missing from the avatar library.";
        return;
      }

      this.busy = true;
      try {
        /*
         * Write down what they were wearing before the side goes on, so that
         * leaving Outlands can give it back. This has to happen before the
         * swap: once the POST returns, the member's own avatar is gone from
         * the store and there is nothing left to remember.
         */
        rememberAvatarBeforeOutlands(this.$store.data.user.avatar);
        const response = await this.$http.post("/member/update_avatar", {
          avatarId: avatar.id,
        });
        /*
         * The token carries the avatar row, but nothing decodes it back into
         * the store, so the fields the world needs are written here. Without
         * the file name the browser identity and the side both stay stale.
         */
        this.$store.methods.setToken(response.data.token);
        this.$store.data.user.avatar.id = avatar.id;
        this.$store.data.user.avatar.name = avatar.name;
        this.$store.data.user.avatar.filename = avatar.filename;
        this.$store.data.user.avatar.directory = avatar.directory;
        this.$store.data.user.avatar.image = avatar.image;
        this.$root.$emit("outlands-team-selected");
      } catch (errorResponse: any) {
        this.error = "That avatar could not be worn. Please try again.";
      } finally {
        this.busy = false;
      }
    },
  },
  mounted() {
    this.$http.get("/avatar")
      .then(response => {
        const library = {};
        response.data.avatars.forEach(avatar => {
          if (ENTRANCE_ART[avatar.filename]) library[avatar.filename] = avatar;
        });
        this.library = library;
        if (!Object.keys(library).length) {
          this.error = "The Outlands team avatars are missing from the avatar library.";
        }
      })
      .catch(() => {
        this.error = "The avatar library could not be read.";
      });
  },
});
</script>

<style scoped>
/*
 * The historical entrance was a black page of Arial set against cyan rules.
 * It is reproduced here as a centred column rather than the fixed-width table
 * layout of the capture, so it stays readable at current window sizes.
 */
.outlands-entrance {
  height: 100%;
  overflow-y: auto;
  background: #000000;
  color: #e0e0e0;
  font-family: Arial, Helvetica, sans-serif;
  font-size: 0.8125rem;
  line-height: 1.45;
}

.outlands-entrance__page {
  max-width: 46rem;
  margin: 0 auto;
  padding: 1rem 1rem 3rem;
}

.outlands-entrance img {
  max-width: 100%;
  height: auto;
}

.oe-center { text-align: center; }
.oe-banner { display: block; margin: 0 auto 0.75rem; }
.outlands-entrance p { margin: 0 0 0.75rem; }
.outlands-entrance a { color: #66ffff; }

/* The picker. Two cells, exactly as the historical table had them. */
.oe-teams {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 1.5rem;
}

.oe-team {
  border: 0;
  margin: 0;
  padding: 0;
  display: flex;
  gap: 0.25rem;
}

.oe-avatar {
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  line-height: 0;
}

.oe-avatar:disabled { cursor: not-allowed; opacity: 0.4; }
.oe-avatar:focus-visible { outline: 2px solid #66ffff; outline-offset: 2px; }

.oe-pass {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  margin: 1rem auto 0;
  max-width: 30rem;
  text-align: right;
}

.oe-pass label {
  font-size: 0.6875rem;
  color: #00ffff;
  flex: 1 1 16rem;
}

.oe-pass input { color: #000000; padding: 0 0.25rem; }

.oe-notice { color: #ffff00; text-align: center; margin-top: 0.75rem; }
.oe-error { color: #ff0000; text-align: center; margin-top: 0.75rem; }

.oe-title {
  text-align: center;
  font-size: 1.15rem;
  font-weight: bold;
  margin: 1.5rem 0 0;
}

.oe-rule-center { width: 25%; margin: 0.25rem auto 1.5rem; border-color: #666666; }
.oe-rule { width: 25%; margin: 0.25rem 0 0.75rem; border-color: #666666; }

.oe-body h3 { color: #66ffff; font-weight: bold; margin-top: 1.5rem; }
.oe-body ul { list-style: disc; margin: 0 0 0.75rem 1.5rem; }

.oe-body blockquote { margin: 0 0 0.75rem 2.5rem; }

.oe-warn { color: #ff0000; }
.oe-warn b { color: #ff0000; }
.oe-dim { color: #cccccc; }
.oe-tip { color: #ffff00; }
.oe-d { color: #ff0000; }
.oe-a { color: #ffff00; }
.oe-w { color: #33ff33; }

.oe-ammo {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-around;
  gap: 1rem;
  text-align: center;
  margin-bottom: 0.75rem;
}

.oe-cannon {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem;
}

.oe-cannon p { flex: 1 1 18rem; }

.oe-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

/*
 * Weapon information, in place of the historical control-panel frame. Fixed to
 * the viewport, the way CTR's own modals are, so it stays centred wherever the
 * long instructions have been scrolled to.
 */
.oe-info {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.8);
  padding: 1rem;
}

.oe-info__box {
  background: #002020;
  border: 1px solid #66ffff;
  padding: 1rem;
  max-width: 26rem;
  max-height: 100%;
  overflow-y: auto;
  text-align: center;
}

.oe-info__box h3 { color: #66ffff; font-weight: bold; margin-bottom: 0.5rem; }
.oe-info__box img { margin: 0 auto 0.5rem; }
.oe-info__box table { margin: 0 auto 0.75rem; }
.oe-info__box th, .oe-info__box td { padding: 0 0.75rem; }
.oe-info__box th { color: #66ffff; font-weight: bold; }
</style>
