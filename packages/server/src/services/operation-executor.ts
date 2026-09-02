import crypto from 'node:crypto';
import type { OperationRecord, OperationRepository } from '../db/database.js';

export type OperationHandler = (operation: OperationRecord) => Promise<void> | void;

export class OperationExecutor {
  private readonly handlers = new Map<string, OperationHandler>();

  constructor(
    private readonly repository: OperationRepository,
    private readonly workerId = `worker-${crypto.randomUUID()}`
  ) {}

  register(kind: string, handler: OperationHandler): void {
    this.handlers.set(kind, handler);
  }

  async process(operationId: number): Promise<OperationRecord | undefined> {
    const operation = this.repository.claimOperation(operationId, this.workerId);
    if (!operation) return this.repository.getOperation(operationId);

    const handler = this.handlers.get(operation.kind);
    if (!handler) {
      return this.repository.failOperation(operation.id, this.workerId, {
        code: 'UNSUPPORTED_OPERATION',
        message: `No handler registered for operation kind: ${operation.kind}`
      });
    }

    try {
      await handler(operation);
      return this.repository.completeOperation(operation.id, this.workerId);
    } catch (error) {
      return this.repository.failOperation(operation.id, this.workerId, error);
    }
  }

  async processPending(): Promise<void> {
    while (true) {
      const operation = this.repository.claimNextOperation(this.workerId);
      if (!operation) return;
      const handler = this.handlers.get(operation.kind);
      if (!handler) {
        this.repository.failOperation(operation.id, this.workerId, {
          code: 'UNSUPPORTED_OPERATION',
          message: `No handler registered for operation kind: ${operation.kind}`
        });
        continue;
      }
      try {
        await handler(operation);
        this.repository.completeOperation(operation.id, this.workerId);
      } catch (error) {
        this.repository.failOperation(operation.id, this.workerId, error);
      }
    }
  }
}
