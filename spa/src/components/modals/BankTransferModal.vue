<!--
  The Cybertown CityCash Transfer Console.

  A restoration of the Bank's three-phase transfer flow (colonycity/templates/bank/
  phase1.tmpl, phase2.tmpl and the two result screens built inside phase3.pl). Historically
  this opened as a 612x490 popup window; here it is one modal whose `phase` state walks the
  same three screens, which is CTR's answer to the problem the popup was solving.

  The console chrome is the ORIGINAL artwork, recovered from a 2010 Wayback capture and
  dimension-matched against the Bank templates: top 575x171, left 55x182, right 48x182,
  bottombar 575x21, bottomleft 263x81, bottomdivider 11x81, bottomright 54x81, and the
  transfer/cancel buttons at 141x24 and 106x24 over their 141x57 and 106x57 under-plates.

  Two honest caveats, both worth keeping in this comment rather than only in a report:

  1. The recovered slices are the FUNDBOX skin. Bank and Fundbox shared one console design
     with two skins, and the Bank's own skin (places/bank/images/top.jpg, and the
     bcashtransfer.gif / bbankinfo.gif buttons) has not been recovered. The geometry is
     exact; the banner artwork is its sibling's.
  2. Only the phase-1 slices survive. Every confirm/error/success-state slice --
     confirm.jpg, back.jpg, new.jpg, close.jpg, blank.jpg, bottomleftconfirm.jpg,
     bottomlefterror.jpg -- is lost, so phases 2 and 3 reuse the surviving chrome with
     period-styled HTML buttons in place of images. Those buttons are reconstruction, not
     recovery.

  The historical spacer.gif that the original's layout tables depended on is also missing,
  so widths are CSS here.

  Deliberately NOT ported: the original's checkamt() client-side validation. Its nested
  `< balance` / `> 0` tests made the "You cannot transfer more than you have" branch fire
  for every valid amount, and client validation was never the constraint anyway -- the
  server owns every rule (see BankService).
-->
<template>
  <Modal>
    <template v-slot:header>
      <button type="button" class="btn-ui-inline" @click="close('Modal closed')">X</button>
    </template>
    <template v-slot:body>
      <div class="bank-console">
        <img :src="art('top')" width="575" height="171" alt="Cybertown CityCash Transfer" />

        <div class="bank-console-middle">
          <img :src="art('left')" width="55" height="182" alt="" />
          <div class="bank-console-panel">

            <!-- Phase 1: enter the transfer -->
            <template v-if="phase === 'entry'">
              <p class="bank-line">
                <span class="bank-label">Welcome</span>
                <span class="bank-value">{{ account.username }}</span
                ><span class="bank-label">, You Currently have</span>
                <span class="bank-value">{{ account.balance }}cc</span>
                <span class="bank-label">in your CT Account.</span>
              </p>

              <p v-if="!account.canTransfer" class="bank-error">
                Sorry you need to have a home in CT to use this function
              </p>

              <table class="bank-form">
                <tr>
                  <td class="bank-label">
                    Please enter the name of the citizen you would like to transfer funds to:
                  </td>
                  <td>
                    <input
                      type="text"
                      class="input-text"
                      maxlength="16"
                      size="16"
                      v-model="recipient"
                      :disabled="!account.canTransfer"
                    />
                  </td>
                </tr>
                <tr>
                  <td class="bank-label">Please enter a description for this transfer:</td>
                  <td>
                    <input
                      type="text"
                      class="input-text"
                      maxlength="30"
                      size="16"
                      v-model="memo"
                      :disabled="!account.canTransfer"
                    />
                  </td>
                </tr>
                <tr>
                  <td class="bank-label">Please enter amount to transfer:</td>
                  <td>
                    <input
                      type="text"
                      class="input-text"
                      maxlength="10"
                      size="16"
                      v-model="amount"
                      :disabled="!account.canTransfer"
                    />
                  </td>
                </tr>
              </table>

              <p v-if="error" class="bank-error">{{ error }}</p>
            </template>

            <!-- Phase 2: confirm. Note the memo is not echoed here; the original's
                 confirmation screen did not show it either. -->
            <template v-else-if="phase === 'confirm'">
              <table class="bank-confirm">
                <tr>
                  <td class="bank-label">Transfer from:</td>
                  <td class="bank-value">{{ account.username }}</td>
                </tr>
                <tr>
                  <td class="bank-label">The Sum of:</td>
                  <td class="bank-value">{{ amount }} cc</td>
                </tr>
                <tr>
                  <td class="bank-label">to:</td>
                  <td class="bank-value">{{ recipient }}</td>
                </tr>
              </table>
              <p v-if="error" class="bank-error">{{ error }}</p>
            </template>

            <!-- Phase 3: the result -->
            <template v-else>
              <template v-if="error">
                <p class="bank-label">There has been a problem during this transfer,</p>
                <p class="bank-error">{{ error }}</p>
                <p class="bank-label">Please go back and try again</p>
              </template>
              <template v-else>
                <table class="bank-confirm">
                  <tr>
                    <!-- The original's own label read "Transfered from:". The misspelling
                         is corrected here for the same reason as the server's refusal
                         copy -- see REFUSAL_MESSAGES in api bank.controller.ts. -->
                    <td class="bank-label">Transferred from:</td>
                    <td class="bank-value">{{ account.username }}</td>
                  </tr>
                  <tr>
                    <td class="bank-label">The Sum of:</td>
                    <td class="bank-value">{{ result.amount }} cc</td>
                  </tr>
                  <tr>
                    <td class="bank-label">to:</td>
                    <td class="bank-value">{{ result.recipient }}</td>
                  </tr>
                </table>
                <p class="bank-success">Transaction Completed!</p>
                <p class="bank-line">
                  <span class="bank-label">You now have</span>
                  <span class="bank-value">{{ account.balance }}cc</span>
                  <span class="bank-label">in your CT Account.</span>
                </p>
              </template>
            </template>

          </div>
          <img :src="art('right')" width="48" height="182" alt="" />
        </div>

        <img :src="art('bottombar')" width="575" height="21" alt="" />

        <div class="bank-console-actions">
          <img :src="art('bottomleft')" width="263" height="81" alt="" />

          <div class="bank-button-stack">
            <!-- Phase 1's buttons are the recovered images; later phases are
                 reconstructed, because their slices did not survive. -->
            <template v-if="phase === 'entry'">
              <a
                href="#"
                @click.prevent="review"
                :class="{ 'bank-disabled': !account.canTransfer }"
              >
                <img :src="art('transfer')" width="141" height="24" alt="TRANSFER" />
              </a>
            </template>
            <button v-else-if="phase === 'confirm'" class="btn bank-btn" :disabled="submitting"
              @click="submit">
              {{ submitting ? "..." : "CONFIRM" }}
            </button>
            <button v-else class="btn bank-btn" @click="restart">NEW</button>
            <img :src="art('underbuttonleft')" width="141" height="57" alt="" />
          </div>

          <img :src="art('bottomdivider')" width="11" height="81" alt="" />

          <div class="bank-button-stack">
            <template v-if="phase === 'entry'">
              <a href="#" @click.prevent="close('Modal closed')">
                <img :src="art('cancel')" width="106" height="24" alt="CANCEL" />
              </a>
            </template>
            <button v-else-if="phase === 'confirm'" class="btn bank-btn" @click="back">
              BACK
            </button>
            <button v-else class="btn bank-btn" @click="close('Modal closed')">CLOSE</button>
            <img :src="art('underbuttonright')" width="106" height="57" alt="" />
          </div>

          <img :src="art('bottomright')" width="54" height="81" alt="" />
        </div>
      </div>
    </template>
  </Modal>
</template>

<script lang="ts">
import Vue from "vue";

import Modal from "./Modal.vue";
import ModalMixin from "./mixins/ModalMixin";

/** Where the recovered console slices are served from. */
const ART_ROOT = "/assets/img/place/bank/console";

/**
 * Names one transfer INTENT, so the server can tell a retry from a second transfer.
 *
 * Generated per intent, not per request: the same key survives the submit, any network-level
 * retry of it, and any retry of reading the response. A new one is minted only when the
 * console is reset -- by NEW after a completed transfer, or by reopening the console -- which
 * is exactly the boundary at which the citizen has decided to make a DIFFERENT transfer. That
 * is what lets someone deliberately send the same amount to the same citizen twice while a
 * double-submit of one transfer still moves money once.
 *
 * `crypto.randomUUID` where available; `getRandomValues` otherwise, because randomUUID is
 * restricted to secure contexts and CTR is reachable over plain HTTP. Both give 128 bits, so
 * a collision between two citizens is not a practical concern -- and its consequence would
 * be a refused transfer with a conflict message, never a transfer credited to the wrong
 * person, because the server compares the whole operation before honouring a key.
 */
function newIntentKey(): string {
  // `randomUUID` is widened onto the type here rather than assumed: this project's
  // TypeScript lib predates it, so `Crypto` does not declare it and the build fails on the
  // call. The `typeof` guard is what actually decides whether it exists at runtime -- the
  // annotation only stops the compiler objecting to a check it cannot verify.
  const api = window.crypto as Crypto & { randomUUID?: () => string };
  if (api && typeof api.randomUUID === "function") return api.randomUUID();
  if (api && typeof api.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    api.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  }
  // Last resort for an environment with no Web Crypto at all. Weaker, but the failure mode
  // of a collision is still a refusal rather than a misdirected transfer.
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

export default Vue.extend({
  name: "BankTransferModal",
  components: { Modal },
  props: {
    /**
     * A value unique to each opening of the console. Watched, not merely read.
     *
     * ModalRoot renders the active modal through `<component :is>` and, when the same
     * component is opened again, Vue patches the EXISTING instance rather than creating a
     * new one -- so `data()` and `created()` do not run a second time. Without this, a
     * console left on its result screen reopens still showing the previous transfer,
     * including the previous citizen's name and balance if someone else has logged in
     * since. For a money form that is not merely stale, it is wrong.
     *
     * Confining the fix here rather than changing ModalRoot's instance handling, which
     * every other modal in the application also depends on.
     */
    openId: {
      type: Number,
      default: 0,
    },
  },
  watch: {
    openId(): void {
      this.resetConsole();
    },
  },
  data: () => {
    return {
      /** Which of the three historical screens is showing. */
      phase: "entry",
      account: {
        username: "",
        balance: 0,
        canTransfer: false,
      },
      recipient: "",
      memo: "",
      amount: "",
      error: undefined,
      result: {
        recipient: "",
        amount: 0,
      },
      submitting: false,
      /**
       * Key naming the transfer the citizen is currently composing. Minted here and again
       * on every reset; deliberately NOT re-minted on submit, so a retry of one intent
       * carries the key that identifies it.
       */
      idempotencyKey: newIntentKey(),
    };
  },
  async created() {
    await this.load();
  },
  methods: {
    art(name: string): string {
      return `${ART_ROOT}/${name}.jpg`;
    },
    async load(): Promise<void> {
      try {
        const { data } = await this.$http.get("/bank/account");
        this.account = data.account;
      } catch (error: any) {
        this.error = error.response?.data?.error ?? "Could not reach the Bank.";
      }
    },
    /**
     * Moves to the confirmation screen.
     *
     * Only the two checks the original's own form made -- something in the amount field,
     * and a recipient to send to. Everything else is the server's call, and the server is
     * asked on submit. Guessing at refusals here would only risk disagreeing with it.
     */
    review(): void {
      if (!this.account.canTransfer) return;
      if (!this.recipient.trim()) {
        this.error = "No Such Citizen!";
        return;
      }
      if (!this.amount.toString().trim()) {
        this.error = "Please enter in an amount";
        return;
      }
      this.error = undefined;
      this.phase = "confirm";
    },
    back(): void {
      this.error = undefined;
      this.phase = "entry";
    },
    async submit(): Promise<void> {
      // Guards the double-submit the original had no answer for: its confirm button could
      // be clicked twice and would transfer twice.
      if (this.submitting) return;
      this.submitting = true;
      try {
        const { data } = await this.$http.post("/bank/transfer", {
          recipient: this.recipient.trim(),
          amount: this.amount,
          memo: this.memo,
        // `false` is the formData flag, which this request is not; the headers are the
        // FOURTH argument. See the note on api.ts's `post` -- passing a config object in
        // the third position sends multipart and drops the header silently.
        }, false, {
          // The intent's key, unchanged across every attempt at this transfer. The guard
          // above stops a second click while one request is in flight; this stops a second
          // TRANSFER when the request itself is retried -- by the browser, by a proxy, or
          // by a citizen resubmitting after a response that never arrived.
          "Idempotency-Key": this.idempotencyKey,
        });
        this.result = { recipient: data.recipient, amount: data.amount };
        this.account.balance = data.balance;
        this.error = undefined;
        this.phase = "result";
      } catch (error: any) {
        this.error = error.response?.data?.error
          ?? "There has been a problem during this transfer.";
        this.phase = "result";
      } finally {
        this.submitting = false;
      }
    },
    /** Back to a blank form, as the original's NEW button did. */
    async restart(): Promise<void> {
      await this.resetConsole();
    },
    /** Clears every field and re-reads the account from the server. */
    async resetConsole(): Promise<void> {
      this.recipient = "";
      this.memo = "";
      this.amount = "";
      this.error = undefined;
      this.result = { recipient: "", amount: 0 };
      this.submitting = false;
      this.phase = "entry";
      // A fresh intent. Whatever the citizen composes next is a NEW transfer, even if they
      // type the same recipient and amount again -- which the historical Bank allowed and
      // this must not prevent. Minted here rather than after a successful submit so that a
      // failed transfer keeps its key and can be retried as the same intent.
      this.idempotencyKey = newIntentKey();
      await this.load();
    },
  },
  mixins: [ModalMixin],
});
</script>

<style scoped>
/*
 * Widths are fixed to the original's table geometry so the recovered slices line up
 * exactly: a 575px console with 55px and 48px side rails around a 472px panel.
 */
.bank-console {
  width: 575px;
  max-width: 100%;
  background: #000;
  font-family: Arial, Helvetica, sans-serif;
}
.bank-console img {
  display: block;
}
.bank-console-middle {
  display: flex;
  align-items: stretch;
}
.bank-console-middle > img {
  flex: none;
  align-self: flex-start;
}
.bank-console-panel {
  flex: 1;
  min-width: 0;
  padding: 8px 10px;
  background: #000;
  font-size: 0.875rem;
}
.bank-console-actions {
  display: flex;
  align-items: flex-start;
}
.bank-console-actions > img {
  flex: none;
}
.bank-button-stack {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
/* The original's palette: white prose, yellow for names and amounts. */
.bank-label {
  color: #ffffff;
}
.bank-value {
  color: #ffff00;
}
.bank-line > span {
  margin-right: 0.25rem;
}
.bank-error {
  color: #ff4d4d;
  margin-top: 0.5rem;
}
.bank-success {
  color: #00df00;
  margin-top: 0.5rem;
}
.bank-form td,
.bank-confirm td {
  padding: 2px 6px 2px 0;
  vertical-align: middle;
}
.bank-form td:first-child {
  width: 305px;
}
/* Reconstructed buttons, sized to the footprint the lost slices occupied. */
.bank-btn {
  width: 141px;
  height: 24px;
  padding: 0;
  font-size: 0.75rem;
  line-height: 1;
}
.bank-disabled {
  opacity: 0.4;
  pointer-events: none;
}
</style>
