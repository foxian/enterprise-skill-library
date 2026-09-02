import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  initDatabase,
  OperationAuditRepository,
  OperationRepository
} from '../src/db/database.js';

describe('Operation persistence', () => {
  let tmpDir: string;
  let dbPath: string;
  let db: ReturnType<typeof initDatabase> | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-operation-'));
    dbPath = path.join(tmpDir, 'test.db');
  });

  afterEach(() => {
    db?.close();
    db = undefined;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the operation and audit tables with the recoverable fields', () => {
    db = initDatabase(dbPath);

    expect((db.pragma('table_info(operations)') as { name: string }[]).map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'id',
        'idempotency_key',
        'kind',
        'status',
        'payload_json',
        'attempts',
        'max_attempts',
        'next_retry_at',
        'lease_owner',
        'lease_until',
        'error_json',
        'created_at',
        'updated_at'
      ])
    );
    expect((db.pragma('table_info(operation_audits)') as { name: string }[]).map((column) => column.name)).toEqual(
      expect.arrayContaining(['id', 'operation_id', 'event', 'actor', 'details_json', 'created_at'])
    );

  });

  it('creates operations idempotently and returns the existing operation for a repeated key', () => {
    db = initDatabase(dbPath);
    const repository = new OperationRepository(db);

    const created = repository.createOperation({
      idempotencyKey: 'org:acme:provision',
      kind: 'organization.provision',
      payload: { orgName: 'acme' }
    });
    const repeated = repository.createOperation({
      idempotencyKey: 'org:acme:provision',
      kind: 'organization.provision',
      payload: { orgName: 'acme' }
    });

    expect(repeated).toEqual(created);
    expect(created.maxAttempts).toBe(5);
    expect(repository.getOperationByIdempotencyKey('org:acme:provision')?.payload).toEqual({ orgName: 'acme' });
    expect(() =>
      repository.createOperation({
        idempotencyKey: 'org:acme:provision',
        kind: 'member.create',
        payload: { orgName: 'acme', username: 'alice' }
      })
    ).toThrow('Idempotency key already belongs to another operation');

  });

  it('claims only eligible operations and renews an atomic sixty-second lease', () => {
    db = initDatabase(dbPath);
    const now = new Date('2026-09-02T00:00:00.000Z');
    const repository = new OperationRepository(db, { now: () => now });
    const created = repository.createOperation({
      idempotencyKey: 'org:acme:provision',
      kind: 'organization.provision',
      payload: { orgName: 'acme' }
    });

    const claimed = repository.claimOperation(created.id, 'worker-a');
    expect(claimed).toMatchObject({
      id: created.id,
      status: 'running',
      attempts: 1,
      leaseOwner: 'worker-a',
      leaseUntil: '2026-09-02T00:01:00.000Z'
    });
    expect(repository.claimOperation(created.id, 'worker-b')).toBeUndefined();
    expect(repository.claimNextOperation('worker-b')).toBeUndefined();
    expect(repository.completeOperation(created.id, 'worker-b')).toBeUndefined();
    expect(repository.completeOperation(created.id, 'worker-a')?.status).toBe('succeeded');

  });

  it('retries failed operations with exponential backoff and permanently fails at the attempt limit', () => {
    let now = new Date('2026-09-02T00:00:00.000Z');
    db = initDatabase(dbPath);
    const repository = new OperationRepository(db, { now: () => now, retryBaseDelayMs: 1000 });
    const created = repository.createOperation({
      idempotencyKey: 'skill:upload:abc',
      kind: 'skill.upload',
      payload: { skillName: '@acme/demo' },
      maxAttempts: 2
    });

    const firstClaim = repository.claimOperation(created.id, 'worker-a');
    expect(repository.failOperation(created.id, 'worker-a', new Error('password=top-secret'))).toMatchObject({
      status: 'failed',
      attempts: 1,
      nextRetryAt: '2026-09-02T00:00:01.000Z',
      error: { code: 'OPERATION_FAILED', message: 'password=[REDACTED]' }
    });
    expect(firstClaim?.attempts).toBe(1);

    now = new Date('2026-09-02T00:00:01.000Z');
    expect(repository.claimOperation(created.id, 'worker-a')?.attempts).toBe(2);
    expect(repository.failOperation(created.id, 'worker-a', { code: 'GITEA_503', message: 'temporary failure' })).toMatchObject({
      status: 'permanently_failed',
      attempts: 2,
      nextRetryAt: null
    });

    const retried = repository.retryOperation(created.id);
    expect(retried).toMatchObject({
      status: 'pending',
      attempts: 0,
      nextRetryAt: null,
      leaseOwner: null,
      error: null
    });

  });

  it('reclaims an expired lease and never stores stack traces or secret fields', () => {
    let now = new Date('2026-09-02T00:00:00.000Z');
    db = initDatabase(dbPath);
    const repository = new OperationRepository(db, { now: () => now });
    const created = repository.createOperation({
      idempotencyKey: 'member:create:alice',
      kind: 'member.create',
      payload: { username: 'alice' }
    });

    repository.claimOperation(created.id, 'worker-a');
    now = new Date('2026-09-02T00:01:01.000Z');
    const reclaimed = repository.claimOperation(created.id, 'worker-b');
    expect(reclaimed?.leaseOwner).toBe('worker-b');
    expect(reclaimed?.attempts).toBe(2);

    const failed = repository.failOperation(created.id, 'worker-b', {
      code: 'GITEA_ERROR',
      message: 'authorization=Bearer very-secret-token',
      stack: 'secret stack trace',
      password: 'another-secret'
    });
    expect(failed?.error).toEqual({
      code: 'GITEA_ERROR',
      message: 'authorization=Bearer [REDACTED]',
      details: {}
    });
    expect(JSON.stringify(failed)).not.toContain('very-secret-token');
    expect(JSON.stringify(failed)).not.toContain('secret stack trace');

  });

  it('prevents an expired worker from completing or failing an operation', () => {
    let now = new Date('2026-09-02T00:00:00.000Z');
    db = initDatabase(dbPath);
    const repository = new OperationRepository(db, { now: () => now });
    const created = repository.createOperation({
      idempotencyKey: 'org:acme:provision',
      kind: 'organization.provision',
      payload: { orgName: 'acme' }
    });

    repository.claimOperation(created.id, 'worker-a');
    now = new Date('2026-09-02T00:01:01.000Z');
    expect(repository.completeOperation(created.id, 'worker-a')).toBeUndefined();
    expect(repository.failOperation(created.id, 'worker-a', new Error('late failure'))).toBeUndefined();
    expect(repository.claimOperation(created.id, 'worker-b')?.attempts).toBe(2);
  });

  it('marks an expired final attempt as permanently failed instead of leaving it running', () => {
    let now = new Date('2026-09-02T00:00:00.000Z');
    db = initDatabase(dbPath);
    const repository = new OperationRepository(db, { now: () => now });
    const created = repository.createOperation({
      idempotencyKey: 'skill:publish:abc',
      kind: 'skill.publish',
      payload: { skillName: '@acme/demo' },
      maxAttempts: 1
    });

    repository.claimOperation(created.id, 'worker-a');
    now = new Date('2026-09-02T00:01:01.000Z');
    expect(repository.claimOperation(created.id, 'worker-b')).toBeUndefined();
    expect(repository.getOperation(created.id)?.status).toBe('permanently_failed');
  });

  it('writes and queries structured audit records', () => {
    db = initDatabase(dbPath);
    const operations = new OperationRepository(db);
    const audits = new OperationAuditRepository(db);
    const operation = operations.createOperation({
      idempotencyKey: 'org:acme:provision',
      kind: 'organization.provision',
      payload: { orgName: 'acme' }
    });

    const audit = audits.record({
      operationId: operation.id,
      event: 'operation.created',
      actor: 'admin',
      details: { status: 'pending', password: 'must-not-be-stored' }
    });

    expect(audit).toMatchObject({
      operationId: operation.id,
      event: 'operation.created',
      actor: 'admin',
      details: { status: 'pending' }
    });
    expect(JSON.stringify(audit)).not.toContain('must-not-be-stored');
    expect(audits.listByOperation(operation.id)).toEqual([audit]);
  });
});
