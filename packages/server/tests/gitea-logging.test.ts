import { afterEach, describe, expect, it, vi } from 'vitest';
import { GiteaService } from '../src/services/gitea.js';
import { createLogCapture, recordsForEvent, type LogCapture } from './helpers/log-capture.js';

// Git Backend 依赖调用的日志契约（ADR-0045）：通过可控依赖产生成功、失败与慢
// 调用场景，验证结构化字段与级别，而不是去测真实外部服务。
describe('Git backend call log', () => {
  let capture: LogCapture;

  function serviceWith(fetchImpl: unknown): GiteaService {
    capture = createLogCapture();
    return new GiteaService(
      'http://gitea:3000',
      'admin-token',
      fetchImpl as never,
      'eslroot',
      'root-password',
      capture.logger
    );
  }

  const okJson = (body: unknown = {}) => ({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body)
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records a successful call at debug with dependency, operation, method and duration', async () => {
    const service = serviceWith(vi.fn().mockResolvedValue(okJson({ id: 1, name: 'esl-skills' })));

    await service.organizationExists('esl-skills');

    const calls = recordsForEvent(capture, 'dependency.call');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      level: 20,
      outcome: 'succeeded',
      dependency: 'gitea',
      operation: 'organizationExists',
      method: 'GET',
      statusCode: 200
    });
    expect(typeof calls[0].durationMs).toBe('number');
  });

  it('records an upstream 5xx at error with a stable infrastructure error code', async () => {
    const service = serviceWith(
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => 'backend down'
      })
    );

    await expect(service.organizationExists('esl-skills')).rejects.toThrow();

    const calls = recordsForEvent(capture, 'dependency.call');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      level: 50,
      outcome: 'failed',
      operation: 'organizationExists',
      method: 'GET',
      statusCode: 503,
      errorCode: 'gitBackendUnavailable'
    });
  });

  it('records a transport failure at error and still rethrows', async () => {
    const service = serviceWith(vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    await expect(service.organizationExists('esl-skills')).rejects.toThrow('ECONNREFUSED');

    const calls = recordsForEvent(capture, 'dependency.call');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      level: 50,
      outcome: 'failed',
      errorCode: 'gitBackendUnavailable'
    });
    expect((calls[0].err as { message: string }).message).toBe('ECONNREFUSED');
  });

  it('marks a call slower than the threshold as slow and raises it to warn', async () => {
    vi.useFakeTimers();
    const service = serviceWith(
      vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        return okJson({ id: 1, name: 'esl-skills' });
      })
    );

    const pending = service.organizationExists('esl-skills');
    await vi.advanceTimersByTimeAsync(1200);
    await pending;

    const calls = recordsForEvent(capture, 'dependency.call');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ level: 40, slow: true, outcome: 'succeeded' });
    expect(calls[0].durationMs as number).toBeGreaterThan(1000);
  });

  it('keeps an expected 4xx probe at debug so it does not flood the error log', async () => {
    const service = serviceWith(
      vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'not found' })
    );

    await service.organizationExists('esl-skills');

    const calls = recordsForEvent(capture, 'dependency.call');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ level: 20, outcome: 'failed', statusCode: 404 });
    expect(capture.records.filter((record) => record.level === 50)).toHaveLength(0);
  });

  it('never writes the admin token or the password into the log', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okJson({ sha1: 'issued-user-token' }));
    const service = serviceWith(fetchImpl);

    await service.issueUserToken('alice');

    const serialized = JSON.stringify(capture.records);
    expect(serialized).not.toContain('admin-token');
    expect(serialized).not.toContain('root-password');
    expect(serialized).not.toContain('issued-user-token');
  });
});
