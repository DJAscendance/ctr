<template>
  <Modal>
    <template v-slot:header>
      <button type="button" class="btn-ui-inline" @click="close('Modal closed')">X</button>
    </template>
    <template v-slot:body>
      <div style="width: 700px; max-width: 80vw; height: calc(100vh - 200px); overflow-y: auto;">
        <Directory />
      </div>
    </template>
  </Modal>
</template>

<script lang="ts">
import { defineComponent } from "vue";

import Modal from "./Modal.vue";
import ModalMixin from "./mixins/ModalMixin";
import Directory from "../../pages/directory/Directory.vue";

export default defineComponent({
  name: "DirectoryModal",
  components: { Modal, Directory },
  mixins: [ModalMixin],
});
</script>
