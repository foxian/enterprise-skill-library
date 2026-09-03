import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initDatabase, OperationRepository } from '../src/db/database.js';
import { OperationExecutor } from '../src/services/operation-executor.js';

describe('OperationExecutor', () => {
  let tmpDir: string;
  let db: ReturnType<typeof initDatabase>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-operation-executor-'));
    db = initDatabase(path.join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('claims, executes, and completes an operation', async () => {
    const repository = new OperationRepository(db);
    const executor = new OperationExecutor(repository, 'worker-a');
    const handler = vi.fn().mockResolvedValue(undefined);
    executor.register('organization.provision', handler);
    const operation = repository.createOperation({
      idempotencyKey: 'org:acme:provision',
      kind: 'organization.provision',
      payload: { orgName: 'acme' }
    });

    await executor.process(operation.id);

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: operation.id }));
    expect(repository.getOperation(operation.id)?.status).toBe('succeeded');
  });

  it('records handler failures for a later retry', async () => {
    const repository = new OperationRepository(db);
    const executor = new OperationExecutor(repository, 'worker-a');
    executor.register('organization.provision', async () => {
      throw new Error('Gitea unavailable');
    });
    const operation = repository.createOperation({
      idempotencyKey: 'org:acme:provision',
      kind: 'organization.provision',
      payload: { orgName: 'acme' }
    });

    await executor.process(operation.id);

    expect(repository.getOperation(operation.id)).toMatchObject({
      status: 'failed',
      error: { code: 'OPERATION_FAILED', message: 'Gitea unavailable' }
    });
  });

  it('renews the lease while a long-running handler is executing', async () => {
    const repository = new OperationRepository(db);
    const renewLease = vi.spyOn(repository, 'renewLease');
    const executor = new OperationExecutor(repository, 'worker-a', 5);
    let releaseHandler: (() => void) | undefined;
    const handler = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    executor.register('organization.provision', () => handler);
    const operation = repository.createOperation({
      idempotencyKey: 'org:acme:provision',
      kind: 'organization.provision',
      payload: { orgName: 'acme' }
    });

    const processing = executor.process(operation.id);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const renewedAt = repository.getOperation(operation.id)?.leaseUntil;
    expect(renewLease).toHaveBeenCalled();
    expect(renewedAt).not.toBeNull();

    releaseHandler?.();
    await processing;
    const finalStatus = repository.getOperation(operation.id)?.status;
    expect(finalStatus).toBe('succeeded');
    // 完成后不再续租
    const renewalsAfterSettle = renewLease.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(renewLease.mock.calls.length).toBe(renewalsAfterSettle);
  });
});
