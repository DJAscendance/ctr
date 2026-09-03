<template>
  <div class="flex-1">
    <div align="center">
      <font face="Arial, Helvetica, sans-serif" size="-1">
        <table cellpadding="8">
          <tr>
            <td>
              <div align="center">
                <font color="#00FF00"
                  >Immigration is absolutely FREE, so join NOW!</font
                ><br />
                <font size="+2">CYBERTOWN Immigration - New Member</font>
                <img
                  src="/assets/img/login/immicode.jpeg"
                  border="0"
                  alt="Immigrate"
                />
                <br />
              </div>
              <p align="center" v-if="isBeta" class="text-ctyellow">
                You are immigrating to the {{ betaName }}. This is a test version
                of Cybertown. It updates often, sometimes daily, and bugs are
                expected. Thank you for helping us test it.
              </p>
              <p align="center" v-if="showError" class="text-red-500">
                {{ error }}
              </p>
              <p align="center" v-if="showSuccess && pendingApproval" color="#00FF00">
                Application received! A city administrator will review it by
                hand. We will email you when your account is approved. You will
                not be able to log in until then.
              </p>
              <p align="center" v-else-if="showSuccess" color="#00FF00">
                Account Created!
                <router-link to="/login">Click here to login.</router-link>
              </p>
              <div align="center" v-if="!showSuccess">
                <div class="flex justify-center">
                  <h3 class="p-2"><router-link to="/privacypolicy"> Privacy Policy </router-link></h3>
                  <h3 class="p-2"><router-link to="/rulesandregulations"> Rules and Regulations </router-link></h3>
                  <h3 class="p-2"><router-link to="/constitution"> Constitution </router-link></h3>
                </div>
                
                <br />
                <font color="#ffff00">*** These fields are mandatory!</font>
                <font color="red" size="+1"></font>
                <form
                  method="post"
                  action="/web/20020601150754/http://www.cybertown.com/cgi-bin/cybertown/register"
                  name="im_form"
                  onsubmit="addIM3Text()"
                >
                  <input type="hidden" name="TKT" value="" />
                  <table border="0">
                    <tr>
                      <td colspan="3">
                        <font color="#00FF00" size="+1"
                          >Create your Cybertown Nickname and Password</font
                        >
                      </td>
                    </tr>
                    <tr>
                      <td width="150" valign="top">
                        <font color="#ffff00">***</font> Your nickname:
                      </td>
                      <td width="200" valign="top">
                        <input
                          v-model="username"
                          maxlength="16"
                          size="16"
                          class="input-text"
                        />
                      </td>
                      <td width="200" valign="top">
                        <font color="#00FF00" size="-1"
                          >Allowed characters are
                          [A-Z],[a-z],[0-9],'_','-','.'</font
                        >
                      </td>
                    </tr>
                    <tr>
                      <td valign="top">
                        <font color="#ffff00">***</font> Your email address:
                      </td>
                      <td valign="top">
                        <input
                          v-model="email"
                          maxlength="64"
                          size="32"
                          class="input-text"
                        />
                      </td>
                      <td valign="top" rowspan="2">
                        <font color="#FF0000"
                          >Be sure that you type in your
                          <b>email address correctly</b> as you will receive an
                          <b>immigration email</b> in a few seconds!<br />
                          And don't worry, nobody else will see your email
                          address later!</font
                        >
                      </td>
                    </tr>
                    <tr>
                      <td valign="top">Please re-type your email address:</td>
                      <td valign="top">
                        <input
                          v-model="email2"
                          maxlength="64"
                          size="32"
                          class="input-text"
                        />
                      </td>
                    </tr>
                    <tr>
                      <td valign="top">
                        <font color="#ffff00">***</font> Choose a password:
                      </td>
                      <td valign="top">
                        <input
                          type="password"
                          v-model="password"
                          size="16"
                          maxlength="256"
                          class="input-text"
                        />
                      </td>
                      <td valign="top">&nbsp;</td>
                    </tr>
                    <tr>
                      <td valign="top">
                        <font color="#ffff00">***</font> Retype your password:
                      </td>
                      <td valign="top">
                        <input
                          type="password"
                          v-model="password2"
                          size="16"
                          maxlength="256"
                          class="input-text"
                        />
                      </td>
                      <td valign="top">&nbsp;</td>
                    </tr>
                  </table>
                  <!--
                    The bot check. Rendered only where the deployment configured one, so an
                    installation without Turnstile keeps exactly the form it had. The widget
                    is a normal focusable control in the tab order, and it is followed by a
                    text status so a keyboard or screen-reader user is told the check
                    passed rather than left guessing why the button failed.
                  -->
                  <div v-if="turnstileSiteKey" align="center" class="my-3">
                    <div ref="turnstile" tabindex="0"></div>
                    <p v-if="challengeToken" class="text-ctyellow" role="status">
                      Human check complete.
                    </p>
                    <p v-else class="text-ctyellow" role="status">
                      Please complete the human check above before immigrating.
                    </p>
                  </div>
                  <p align="center">
                    <button
                      type="button"
                      class="btn"
                      value="Immigrate"
                      @click="signup"
                    >
                      Immigrate
                    </button>
                  </p>
                </form>
              </div>
            </td>
          </tr>
        </table>
        <br clear="all" />
      </font>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import appStore from "@/appStore";
import siteConfig from "@/site-config";

/** Cloudflare's Turnstile widget script. */
const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export default Vue.extend({
  name: "SignupPage",
  data() {
    return {
      email: "",
      email2: "",
      username: "",
      password: "",
      password2: "",
      showError: false,
      showSuccess: false,
      pendingApproval: false,
      error: "",
      isBeta: siteConfig.isBeta,
      betaName: `CTNG ${siteConfig.label === "BETA" ? "Beta" : siteConfig.label}`,
      turnstileSiteKey: siteConfig.turnstileSiteKey,
      challengeToken: "",
      widgetId: null as any,
    };
  },
  mounted(): void {
    // Loaded here rather than in index.html so a deployment with no bot challenge never
    // fetches a third-party script at all, and so the widget mounts against a ref that is
    // known to exist. `render=explicit` is what lets us do that.
    if (!this.turnstileSiteKey) return;
    this.loadTurnstile()
      .then(() => this.renderTurnstile())
      .catch(() => {
        // Nothing is faked on failure: with no token the server refuses the immigration,
        // which is the correct outcome. Say so rather than letting the button look broken.
        this.error = "The human check could not be loaded. Please reload the page.";
        this.showError = true;
      });
  },
  beforeDestroy(): void {
    const turnstile = (window as any).turnstile;
    if (turnstile && this.widgetId !== null) {
      turnstile.remove(this.widgetId);
    }
  },
  methods: {
    /** Injects the Turnstile script once, resolving when it is usable. */
    loadTurnstile(): Promise<void> {
      if ((window as any).turnstile) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${TURNSTILE_SCRIPT_SRC}"]`);
        const script = (existing as HTMLScriptElement) || document.createElement("script");
        script.addEventListener("load", () => resolve());
        script.addEventListener("error", () => reject(new Error("turnstile load failed")));
        if (!existing) {
          script.src = TURNSTILE_SCRIPT_SRC;
          script.async = true;
          script.defer = true;
          document.head.appendChild(script);
        }
      });
    },
    renderTurnstile(): void {
      const turnstile = (window as any).turnstile;
      if (!turnstile || !this.$refs.turnstile) return;
      this.widgetId = turnstile.render(this.$refs.turnstile, {
        sitekey: this.turnstileSiteKey,
        callback: (token: string) => {
          this.challengeToken = token;
        },
        // A token is single-use and expires. Clearing it on both events keeps the client
        // from submitting one the server would reject anyway.
        "expired-callback": () => {
          this.challengeToken = "";
        },
        "error-callback": () => {
          this.challengeToken = "";
        },
      });
    },
    async signup() {
      this.showError = false;

      if (this.password !== this.password2) {
        this.error = "Please enter your password the same twice.";
        this.showError = true;
        return;
      }

      // A courtesy check so the form can say something useful before a round trip. It is
      // NOT the enforcement: the API verifies the token with Cloudflare on every request,
      // and a client that skipped this is refused there.
      if (this.turnstileSiteKey && !this.challengeToken) {
        this.error = "Please complete the human check before immigrating.";
        this.showError = true;
        return;
      }

      try {
        const { data } = await this.$http.post("/member/signup", {
          email: this.email,
          username: this.username,
          password: this.password,
          botChallengeToken: this.challengeToken || undefined,
        });
        this.showSuccess = true;

        // Where the deployment reviews immigrations by hand, the server issues no token.
        // Stop here and say so rather than storing an undefined token and walking the
        // applicant into a session that cannot exist.
        if (data.pendingApproval) {
          this.pendingApproval = true;
          return;
        }

        this.$store.methods.setUser({
          username: data.username,
          hasHome: false,
        });

        this.$store.methods.setToken(data.token);
        this.$router.push({ path: "/place/enter" });
      } catch (error: any) {
        // A failed attempt burns the single-use challenge token, so reset the widget --
        // otherwise a user who mistypes their email once can never submit again.
        this.resetChallenge();
        if (error.response.data.error) {
          this.error = error.response.data.error;
          this.showError = true;
        } else {
          this.error = "An unknown error occurred";
          this.showError = true;
        }
      }
    },
    resetChallenge(): void {
      const turnstile = (window as any).turnstile;
      this.challengeToken = "";
      if (turnstile && this.widgetId !== null) {
        turnstile.reset(this.widgetId);
      }
    },
  },
});
</script>
