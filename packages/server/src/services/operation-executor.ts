import crypto from 'node:crypto';
import type { OperationRecord, OperationRepository } from '../db/database.js';

export type OperationHandler = (operation: OperationRecord) => Promise<void> | void;

export class OperationExecutor {
  private readonly handlers = new Map<string, OperationHandler>();

  constructor(
    private readonly repository: OperationRepository,
    private readonly workerId = `worker-${crypto.randomUUID()}`,
    private readonly leaseRenewalMs = 20_000,
    private readonly onSettled?: (operation: OperationRecord) => void
  ) {}

  register(kind: string, handler: OperationHandler): void {
    this.handlers.set(kind, handler);
  }

  async process(operationId: number): Promise<OperationRecord | undefined> {
    const operation = this.repository.claimOperation(operationId, this.workerId);
    if (!operation) return this.repository.getOperation(operationId);

    const handler = this.handlers.get(operation.kind);
    if (!handler) {
      return this.settle(this.repository.failOperation(operation.id, this.workerId, {
        code: 'UNSUPPORTED_OPERATION',
        message: `No handler registered for operation kind: ${operation.kind}`
      }));
    }

    try {
      await this.runWithLeaseRenewal(operation, handler);
      return this.settle(this.repository.completeOperation(operation.id, this.workerId));
    } catch (error) {
      return this.settle(this.repository.failOperation(operation.id, this.workerId, error));
    }
  }

  async processPending(): Promise<void> {
    while (true) {
      const operation = this.repository.claimNextOperation(this.workerId);
      if (!operation) return;
      const handler = this.handlers.get(operation.kind);
      if (!handler) {
        this.settle(this.repository.failOperation(operation.id, this.workerId, {
          code: 'UNSUPPORTED_OPERATION',
          message: `No handler registered for operation kind: ${operation.kind}`
        }));
        continue;
      }
      try {
        await this.runWithLeaseRenewal(operation, handler);
        this.settle(this.repository.completeOperation(operation.id, this.workerId));
      } catch (error) {
        this.settle(this.repository.failOperation(operation.id, this.workerId, error));
      }
    }
  }

  // Notify subscribers (SSE streams) when an operation reaches a settled state.
  // The repository returns undefined when the guarded update was rejected
  // (e.g. another worker took over the lease); nothing to broadcast then.
  private settle(operation: OperationRecord | undefined): OperationRecord | undefined {
    if (operation) {
      this.onSettled?.(operation);
    }
    return operation;
  }

  // 长任务执行期间按固定间隔续租,避免租约过期后被其他执行器重新领取;
  // 若租约已被接管,完成/失败操作的条件更新守卫会阻止本实例落库。
  private async runWithLeaseRenewal(operation: OperationRecord, handler: OperationHandler): Promise<void> {
    if (this.leaseRenewalMs <= 0) {
      await handler(operation);
      return;
    }
    const renewal = setInterval(() => {
      void this.repository.renewLease(operation.id, this.workerId);
    }, this.leaseRenewalMs);
    try {
      await handler(operation);
    } finally {
      clearInterval(renewal);
    }
  }
}
