<template>
  <div class="text-center text-white p-4 overflow-auto h-full">
    <img src="/assets/worlds/ne_game/html/outlands.jpg" class="mx-auto" />
    <p class="mt-3">
      The Outlands is a team battle zone. Choose the side you want to fight for.
      You cannot enter until you have picked one.
    </p>
    <p v-if="error" class="mt-2 text-red-400">{{ error }}</p>
    <div class="flex flex-wrap justify-center mt-4">
      <div v-for="choice in choices" :key="choice.id" class="m-3 text-center">
        <a @click="pick(choice)" class="cursor-pointer">
          <img :src="thumbnail(choice)" :alt="choice.name" class="mx-auto border border-gray-600" />
          <div class="mt-1">{{ choice.label }}</div>
        </a>
      </div>
    </div>
    <p v-if="!choices.length && !error" class="mt-4">Loading the team avatars...</p>
  </div>
</template>

<script lang="ts">
/*
 * TEMPORARY Outlands entrance - X_ITE 16.2.0 migration only.
 *
 * Outlands reads the side a member is on from the avatar they wear, and the
 * historical entry page (ne_game/enter3D.tmpl) is what made them pick one
 * before the world ever loaded. CTR has one avatar for the whole city, so a
 * member arriving in an ordinary avatar has no side, and ne_game.wrl parks
 * them under the map at y = -1000 where a teamless member has always waited.
 *
 * This screen restores that step: it stands in front of the world, offers the
 * four public team avatars, and wears the one the member picks. The world is
 * not loaded until a side exists. The Game Master avatar is not offered; it is
 * not a citizen choice.
 */
import Vue from "vue";
import { OUTLANDS_TEAM_AVATARS } from "@/libs/outlands";

export default Vue.extend({
  name: "OutlandsEntrance",
  data() {
    return {
      choices: [],
      error: "",
    };
  },
  methods: {
    thumbnail(choice): string {
      return `/assets/avatars/${choice.directory}/${choice.image}`;
    },
    async pick(choice): Promise<void> {
      try {
        const response = await this.$http.post("/member/update_avatar", {
          avatarId: choice.id,
        });
        /*
         * The token carries the avatar row, but nothing decodes it back into
         * the store, so the fields the world needs are written here. Without
         * the file name the browser identity and the side both stay stale.
         */
        this.$store.methods.setToken(response.data.token);
        this.$store.data.user.avatar.id = choice.id;
        this.$store.data.user.avatar.name = choice.name;
        this.$store.data.user.avatar.filename = choice.filename;
        this.$store.data.user.avatar.directory = choice.directory;
        this.$store.data.user.avatar.image = choice.image;
        this.$root.$emit("outlands-team-selected");
      } catch (errorResponse: any) {
        this.error = "That avatar could not be worn. Please try again.";
      }
    },
  },
  mounted() {
    this.$http.get("/avatar")
      .then(response => {
        const wanted = OUTLANDS_TEAM_AVATARS;
        const byName = {};
        response.data.avatars.forEach(avatar => { byName[avatar.filename] = avatar; });
        this.choices = wanted
          .filter(entry => byName[entry.filename])
          .map(entry => Object.assign({}, byName[entry.filename], {
            label: byName[entry.filename].name,
            team: entry.team,
          }));
        if (!this.choices.length) {
          this.error = "The Outlands team avatars are missing from the avatar library.";
        }
      })
      .catch(() => {
        this.error = "The avatar library could not be read.";
      });
  },
});
</script>
