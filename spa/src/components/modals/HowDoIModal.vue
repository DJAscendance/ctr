<template>
  <Modal>
    <template v-slot:header>
      <button type="button" class="btn-ui-inline" aria-label="Close" @click="close('Modal closed')">X</button>
    </template>
    <template v-slot:body>
      <div style="width: 700px; max-width: 80vw; height: calc(100vh - 200px);">
        <HowDoI />
      </div>
    </template>
  </Modal>
</template>

<script lang="ts">
import Vue from 'vue';

import Modal from './Modal.vue';
import ModalMixin from './mixins/ModalMixin';
import HowDoI from '../../pages/HowDoI.vue';

export default Vue.extend({
  name: 'HowDoIModal',
  components: { Modal, HowDoI },
  mixins: [ModalMixin],
});
</script>
