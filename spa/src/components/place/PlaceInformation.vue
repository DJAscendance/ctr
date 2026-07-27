<template>
  <div v-if="description" class="place-information" v-html="description"></div>
</template>

<script lang="ts">
import Vue from "vue";

/**
 * Renders a place's staff-authored information above its staffing listing.
 *
 * This is the one component in CTR that intentionally renders place information
 * as HTML, and it lives apart from Information.vue for a reason: a HOME's
 * description is arbitrary text a citizen typed and is rendered through text
 * interpolation so markup is escaped and shown literally. A PLACE's description
 * is different - it is written by staff and sanitized on the server before it is
 * stored (PlaceInformationService.updateInformation -> sanitizeUserHtml), so the
 * value that arrives here has already been through the shared allowlist.
 *
 * Two rules that keep that true:
 *
 *   1. `description` must only ever be assigned from GET /place/:id/information.
 *      Never interpolate anything else into it, and never accept it from a route
 *      parameter or another user-controlled source.
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
