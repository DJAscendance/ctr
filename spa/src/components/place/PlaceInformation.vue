<template>
  <div v-if="description" class="place-information" v-html="description"></div>
</template>

<script lang="ts">
import Vue from "vue";

/**
 * Renders authored Information as HTML, above a place's staffing listing.
 *
 * This is the one component in CTR that intentionally renders Information as
 * HTML. It now serves BOTH kinds, because both reach it under the same contract:
 * a place's information is written by staff and a home's by its owner, and each
 * is sanitized on the server against the shared allowlist before it is stored
 * (PlaceInformationService.updateInformation and
 * HomeService.updateHomeInformation, both -> sanitizeUserHtml - the same one
 * Messageboard and Inbox use). What arrives here has already been filtered.
 *
 * Two rules that keep that true:
 *
 *   1. `description` must only ever be assigned from GET /place/:id/information
 *      or GET /home/information/:placeId. Never interpolate anything else into
 *      it, and never accept it from a route parameter or another user-controlled
 *      source.
 *   2. Sanitizing happens on WRITE, not here. Rendering-time cleaning would leave
 *      the unsafe value sitting in the database for the next reader that forgets.
 *
 * The original rendered this text raw, with no filtering anywhere in blaxxun CS
 * 4.0, 5.1 or 7.0 - see docs/research/classic-place-admin-re-evidence.md section
 * 4.4. The allowlist is what makes restoring the formatting safe.
 */
export default Vue.extend({
  name: "PlaceInformation",
  props: {
    /** Server-sanitized HTML from GET /place/:id/information. */
    description: {
      type: String,
      default: "",
    },
  },
});
</script>

<style scoped>
/*
 * The classic tool wrote into a plain textarea and the result rendered in the
 * place's own body text, so the defaults here follow CTR's page text rather than
 * introducing a card or panel the original never had.
 */
.place-information {
  padding-bottom: 10px;
}

.place-information >>> p {
  margin-bottom: 0.5rem;
}

.place-information >>> ul,
.place-information >>> ol {
  margin-left: 1.25rem;
  margin-bottom: 0.5rem;
}

.place-information >>> ul {
  list-style: disc;
}

.place-information >>> ol {
  list-style: decimal;
}

.place-information >>> a {
  color: #00df00;
  text-decoration: underline;
}

.place-information >>> img {
  max-width: 100%;
}
</style>
