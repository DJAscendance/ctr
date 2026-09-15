<script lang="ts">
import { EventBus } from "@/libs/event-bus";

/**
 * What `ModalRoot` is told when a modal is asked for.
 */
export interface ModalOpenRequest {
  component: unknown;
  props: Record<string, unknown>;
  // eslint-disable-next-line no-unused-vars
  resolve: (value?: unknown) => void;
  // eslint-disable-next-line no-unused-vars
  reject: (reason?: unknown) => void;
}

interface ModalEvents extends Record<string, unknown> {
  open: ModalOpenRequest;
}

/**
 * The modal service: `open(component, props)` resolves with what the modal closed with,
 * or rejects with what it was dismissed with. `ModalRoot` listens for "open".
 *
 * Was a bare `new Vue({ methods })` used as an event bus; Vue 3 removed the instance
 * event API, so it is a typed bus of its own now. Same one method, same promise.
 */
class ModalService extends EventBus<ModalEvents> {
  open(component: unknown, props: Record<string, unknown> = {}): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.emit("open", { component, props, resolve, reject });
    });
  }
}

export type ModalServiceBus = ModalService;

export default new ModalService();
</script>
