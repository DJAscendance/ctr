<!--
  The Bank's 2D view.

  Historically the Bank's own action panel (colonycity/templates/bank/ac_event.tmpl) offered
  three buttons beside the Jumpgate: Bank Information, CityCash Transfer, and Donate
  CityCash. Only the transfer is restored here -- the donate flow belongs to Fundbox/
  PlaceCash, which is a separate lane, and the Bank's help page is not yet reinstated.
-->
<template>
  <div class="text-center">
    <img src="/assets/img/place/bank/bank.jpg" />
    <div class="p-3">
      <button class="btn" @click="openTransfer">CityCash Transfer</button>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

import BankTransferModal from "@/components/modals/BankTransferModal.vue";
import ModalService from "@/components/modals/services/ModalService.vue";

export default Vue.extend({
  name: "BankMain2d",
  data: () => {
    return {};
  },
  methods: {
    openTransfer(): void {
      // A distinct openId per click. ModalRoot reuses the component instance when the
      // same modal is opened again, so the console needs a signal to clear itself --
      // see the prop's comment in BankTransferModal.
      ModalService.open(BankTransferModal, { openId: Date.now() });
    },
  },
});
</script>
