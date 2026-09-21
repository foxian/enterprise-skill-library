import { describe, expect, it } from 'vitest';
import { logEvent, type DiagnosticFields } from '../src/logging.js';
import { createLogCapture } from './helpers/log-capture.js';

describe('diagnostic logger', () => {
  it('writes one JSON line per record with a UTC ISO-8601 timestamp', () => {
    const capture = createLogCapture();

    capture.logger.info({ event: 'test.event' }, 'Fixed english message');

    expect(capture.lines).toHaveLength(1);
    const record = capture.records[0];
    expect(record.msg).toBe('Fixed english message');
    expect(record.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('censors credentials at the top level and nested paths', () => {
    const capture = createLogCapture();

    capture.logger.warn(
      {
        password: 'top-secret-password',
        token: 'top-secret-token',
        authorization: 'token top-secret-authorization',
        cookie: 'esl_session=top-secret-cookie',
        nested: { password: 'nested-secret-password', token: 'nested-secret-token' },
        headers: { authorization: 'token nested-secret-authorization', cookie: 'c=1' },
        deeper: { inner: { token: 'deep-secret-token' } }
      },
      'Credential probe'
    );

    const serialized = JSON.stringify(capture.records[0]);
    for (const secret of [
      'top-secret-password',
      'top-secret-token',
      'top-secret-authorization',
      'top-secret-cookie',
      'nested-secret-password',
      'nested-secret-token',
      'nested-secret-authorization',
      'deep-secret-token'
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(capture.records[0].password).toBe('[redacted]');
  });

  it('records only whitelisted diagnostic fields', () => {
    const capture = createLogCapture();
    const fields: DiagnosticFields & Record<string, unknown> = {
      event: 'skill.published',
      outcome: 'succeeded',
      actorId: 'u_1',
      actorUsername: 'alice',
      organization: 'acme',
      resourceType: 'skill',
      resourceId: 'sk_01J',
      durationMs: 183,
      errorCode: 'skillNotFound',
      // 未知字段必须在运行时被白名单丢弃（ADR-0045），而不是随 logger 一起写出。
      secretNote: 'must not reach the log'
    };

    logEvent(capture.logger, 'info', fields, 'Skill release published');

    const record = capture.records[0];
    expect(record).toMatchObject({
      event: 'skill.published',
      outcome: 'succeeded',
      actorId: 'u_1',
      actorUsername: 'alice',
      organization: 'acme',
      resourceType: 'skill',
      resourceId: 'sk_01J',
      durationMs: 183,
      errorCode: 'skillNotFound',
      msg: 'Skill release published'
    });
    expect(record.secretNote).toBeUndefined();
  });

  it('carries a structured error object with its stack for error records', () => {
    const capture = createLogCapture();

    logEvent(
      capture.logger,
      'error',
      { event: 'request.failed', outcome: 'failed', err: new Error('boom') },
      'Request failed'
    );

    const record = capture.records[0] as { err: { message: string; stack: string }; level: number };
    expect(record.level).toBe(50);
    expect(record.err.message).toBe('boom');
    expect(record.err.stack).toContain('boom');
  });

  it('suppresses records below the configured level', () => {
    const capture = createLogCapture('warn');

    logEvent(capture.logger, 'info', { event: 'test.event' }, 'Suppressed');
    capture.logger.debug('Also suppressed');

    expect(capture.records).toHaveLength(0);
  });
});
