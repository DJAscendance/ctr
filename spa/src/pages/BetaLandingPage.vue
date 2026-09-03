<template>
  <div class="flex-1 overflow-y-auto">
    <div class="beta-landing">
      <header class="beta-panel beta-panel-head">
        <!--
          The archived CTNG masthead. Its bottom ~35px are the old site's baked-in
          navigation strip, clipped here in CSS so the file stays byte-identical to the
          archive and no dead buttons are shown. See assets/img/ctng/README.md.
        -->
        <div class="beta-masthead">
          <img
            src="/assets/img/ctng/ctng-masthead.jpg"
            alt="Cybertown NG - Next Generation"
          />
        </div>
        <h1 class="beta-title">
          {{ siteName }}
          <span class="beta-chip">{{ label }}</span>
        </h1>
        <p class="beta-strap">
          A public test of the Cybertown Revival city. Everyone is welcome.
        </p>
      </header>

      <section class="beta-panel" aria-labelledby="beta-what-heading">
        <h2 id="beta-what-heading">This is a test version of Cybertown</h2>
        <ul class="beta-list">
          <li>This is a development and testing version of Cybertown.</li>
          <li>Features can change at any time.</li>
          <li>
            Updates happen often. Some updates happen daily.
          </li>
          <li>Bugs are expected while the city is being tested.</li>
          <li>
            Please help us test it. Tell us what breaks, and tell us what
            should feel more like the Cybertown you remember.
          </li>
        </ul>
      </section>

      <section class="beta-panel beta-actions" aria-labelledby="beta-join-heading">
        <h2 id="beta-join-heading">Join the test</h2>
        <img
          class="beta-render"
          src="/assets/img/ctng/ctng-transport-gate.jpg"
          alt="Cybertown NG concept art: the Transport Gate, a street corner in the city"
        />
        <p>
          Immigration is free. Fill in the immigration form and a city
          administrator will review your application by hand. We will email you
          when your account is approved.
        </p>
        <p class="beta-buttons">
          <router-link class="btn beta-btn" to="/signup">
            Immigrate to the {{ siteName }}
          </router-link>
          <router-link class="btn beta-btn" to="/login">
            Already a citizen? Log in
          </router-link>
        </p>
      </section>

      <section class="beta-panel" aria-labelledby="beta-bugs-heading">
        <h2 id="beta-bugs-heading">Found a bug?</h2>
        <p v-if="bugReportUrl">
          Bug reports go to the project's GitHub issue tracker. Tell us what you
          did, what you expected, and what happened instead.
        </p>
        <p v-else>
          Bug reporting is not configured on this deployment. Please tell a city
          administrator what went wrong.
        </p>
        <p v-if="bugReportUrl" class="beta-buttons">
          <a
            class="btn beta-btn"
            :href="bugReportUrl"
            target="_blank"
            rel="noopener noreferrer"
          >
            Report a Beta Bug
          </a>
        </p>
      </section>

      <footer class="beta-panel beta-foot">
        <router-link to="/privacypolicy">Privacy Policy</router-link>
        <router-link to="/rulesandregulations">Rules and Regulations</router-link>
        <router-link to="/constitution">Constitution</router-link>
        <router-link to="/about">About Cybertown Revival</router-link>
      </footer>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

import siteConfig from "@/site-config";

/**
 * The public front door of a beta deployment.
 *
 * Reachable with no account and no session -- it is the page a stranger lands on, so it has
 * to say what this site is before it asks for anything. The two things it must not be are a
 * second sign-up system (the button goes to CTR's real immigration form) and an apology
 * page for an access wall.
 *
 * Everything variable comes from the injected site configuration rather than from a
 * hard-coded host name, so the same build serves a beta and a production deployment.
 */
export default Vue.extend({
  name: "BetaLandingPage",
  data() {
    return {
      label: siteConfig.label || "BETA",
      bugReportUrl: siteConfig.bugReportUrl,
    };
  },
  computed: {
    /** "CTNG Beta" on the beta deployment; whatever the label says anywhere else. */
    siteName(): string {
      return `CTNG ${this.label === "BETA" ? "Beta" : this.label}`;
    },
  },
});
</script>

<style scoped>
/*
 * Layout only -- no new artwork. The one image is the Cybertown banner already tracked in
 * this repository and already used as the in-site banner; the rest of the look is borders,
 * panels and type, which is what the art rules for this page allow.
 */
.beta-landing {
  max-width: 46rem;
  margin: 0 auto;
  padding: 1.5rem 1rem 3rem;
}

.beta-panel {
  border: 2px solid #10a4a8;
  background: rgba(0, 0, 0, 0.35);
  padding: 1rem 1.25rem;
  margin-bottom: 1rem;
}

.beta-panel-head {
  text-align: center;
  background: linear-gradient(180deg, rgba(16, 164, 168, 0.25), rgba(0, 0, 0, 0.4));
}

/*
 * The masthead is 691x357 and its last ~35 rows are the archived site's navigation strip.
 * The wrapper's aspect ratio crops to the artwork above it; the image itself is untouched.
 */
.beta-masthead {
  position: relative;
  width: 100%;
  max-width: 691px;
  margin: 0 auto;
  padding-bottom: 46.3%; /* 320 / 691 */
  overflow: hidden;
}

.beta-masthead img {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: auto;
}

.beta-render {
  display: block;
  width: 100%;
  max-width: 640px;
  height: auto;
  margin: 0 auto 0.9rem;
  border: 1px solid #10a4a8;
}

.beta-title {
  margin-top: 0.75rem;
  color: #00ff00;
  font-size: 1.9rem;
  line-height: 1.2;
}

.beta-chip {
  display: inline-block;
  margin-left: 0.4rem;
  padding: 0.05rem 0.45rem;
  border: 2px solid #ffff00;
  color: #ffff00;
  font-size: 0.8rem;
  vertical-align: middle;
  letter-spacing: 0.08em;
}

.beta-strap {
  color: #ffff00;
  margin-top: 0.4rem;
}

.beta-panel h2 {
  color: #00ff00;
  margin-bottom: 0.5rem;
}

.beta-list {
  list-style: square;
  padding-left: 1.25rem;
}

.beta-list li {
  margin-bottom: 0.35rem;
}

.beta-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 0.9rem;
}

/*
 * `.btn` is the site's own button style; this only stops a router-link from being
 * underlined like body text and keeps the tap target big enough on a phone.
 */
.beta-btn {
  display: inline-block;
  text-decoration: none !important;
  color: #000 !important;
  padding: 0.5rem 0.9rem;
}

.beta-foot {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  justify-content: center;
  font-size: 0.9rem;
}

@media (max-width: 30rem) {
  .beta-title {
    font-size: 1.4rem;
  }
  .beta-buttons .beta-btn {
    width: 100%;
    text-align: center;
  }
}
</style>
