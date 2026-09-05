import type { OperationRecord } from '../db/database.js';

export type OperationListener = (operation: OperationRecord) => void;

/**
 * In-memory subscription registry for Operation state changes.
 *
 * Operation execution is a single-process, single-instance concern in this
 * deployment (the OperationExecutor owns every transition), so a plain
 * in-process map is sufficient — no cross-process pub/sub is needed. SSE
 * streams subscribe per operation id and are notified when the executor
 * settles (succeeds or fails) the operation.
 */
export class OperationEventBus {
  private readonly subscribers = new Map<number, Set<OperationListener>>();

  subscribe(operationId: number, listener: OperationListener): () => void {
    let listeners = this.subscribers.get(operationId);
    if (!listeners) {
      listeners = new Set();
      this.subscribers.set(operationId, listeners);
    }
    listeners.add(listener);
    return () => {
      const set = this.subscribers.get(operationId);
      if (!set) return;
      set.delete(listener);
      if (set.size === 0) {
        this.subscribers.delete(operationId);
      }
    };
  }

  publish(operation: OperationRecord): void {
    const listeners = this.subscribers.get(operation.id);
    if (!listeners) return;
    for (const listener of listeners) {
      listener(operation);
    }
  }
}
