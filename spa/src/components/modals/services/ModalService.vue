<script lang="ts"   >
import Vue from 'vue';

/**
 * Vue 2's constructor type folded the `methods` block into the instance type, so
 * `ModalService.open(...)` type-checked straight off `new Vue(...)`. Vue 3's compat build
 * types every `new Vue(...)` as a bare `LegacyPublicInstance` and cannot infer methods.
 * The instance still carries `open` at runtime - unchanged below - so this interface only
 * restores the shape TypeScript used to work out for itself.
 */
export interface ModalServiceBus extends Vue {
  // eslint-disable-next-line no-unused-vars
  open(component: unknown, props?: Record<string, unknown>): Promise<unknown>;
}

export default new Vue({
  methods: {
    open(component, props = {}) {
      return new Promise((resolve, reject) => {
        this.$emit('open', { component, props, resolve, reject });
      });
    }
  }
}) as ModalServiceBus;

</script>
