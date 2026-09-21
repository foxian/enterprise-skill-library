import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createLogCapture, requestRecords } from './helpers/log-capture.js';

// HTTP 应用边界是诊断日志的主测试切入点（ADR-0045）：用应用构建 + in-process
// HTTP 调用走真实路由流程，同时注入可捕获 logger，断言外部可观察的日志契约。
describe('server diagnostic log', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
  });

  // 匿名可用的业务端点：不需要租户组织或 token 就能走完一次真实请求。
  const anonymousEndpoint = '/api/public/platform-info';

  function giteaMock(overrides: Record<string, unknown> = {}) {
    return {
      validateToken: vi.fn().mockResolvedValue(null),
      validateAdminUserToken: vi.fn().mockResolvedValue(null),
      loginUser: vi.fn().mockResolvedValue(null),
      adminUsername: 'eslroot',
      ...overrides
    };
  }

  function buildWithLogger(logger: unknown, overrides: Record<string, unknown> = {}): FastifyInstance {
    return buildApp({
      dbPath: ':memory:',
      giteaService: giteaMock(overrides) as never,
      repoOwner: 'esl-skills',
      logger: logger as never
    });
  }

  it('logs method, path, status code and duration for a completed request', async () => {
    const capture = createLogCapture();
    app = buildWithLogger(capture.logger);

    const response = await app.inject({ method: 'GET', url: anonymousEndpoint });

    expect(response.statusCode).toBe(200);
    // Fastify 把一次请求分成两条记录：方法/路径随请求进入写入，状态码/耗时随
    // 请求完成写入，两者靠 reqId 关联（US7 的「按一次调用聚合完整时间线」）。
    const completed = capture.records.find((record) => record.msg === 'request completed');
    expect(completed).toBeDefined();
    expect(completed!.res).toEqual({ statusCode: 200 });
    expect(typeof completed!.responseTime).toBe('number');

    const { reqId } = completed as { reqId: string };
    const requestRecord = capture.records.find(
      (record) => record.reqId === reqId && record.msg === 'incoming request'
    );
    expect(requestRecord!.req).toEqual({ method: 'GET', url: anonymousEndpoint });
  });

  it('correlates every record of one request under a single request id', async () => {
    const capture = createLogCapture();
    app = buildWithLogger(capture.logger);

    await app.inject({ method: 'GET', url: anonymousEndpoint });

    const requestIds = new Set(requestRecords(capture).map((record) => record.reqId));
    expect(requestRecords(capture).length).toBeGreaterThan(0);
    expect(requestIds.size).toBe(1);
    expect([...requestIds][0]).toEqual(expect.any(String));
  });

  it('keeps health checks out of the log', async () => {
    const capture = createLogCapture();
    app = buildWithLogger(capture.logger);

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    // 启动期的系统记录（sqlite.*）没有 reqId；健康检查不该产生任何请求级记录。
    expect(requestRecords(capture)).toHaveLength(0);
  });

  it('does not repeat the access log for a business route', async () => {
    const capture = createLogCapture();
    app = buildWithLogger(capture.logger);

    await app.inject({ method: 'GET', url: anonymousEndpoint });

    expect(capture.records.filter((record) => record.msg === 'request completed')).toHaveLength(1);
  });

  it('logs a 5xx exactly once with the error object and its stack', async () => {
    const capture = createLogCapture();
    app = buildWithLogger(capture.logger, {
      loginUser: vi.fn().mockRejectedValue(new Error('gitea exploded'))
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'pw' }
    });

    expect(response.statusCode).toBe(500);
    // 响应体保持 Fastify 既有形状不变，日志改造不改变 API 契约。
    expect(JSON.parse(response.body)).toEqual({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'gitea exploded'
    });
    const failures = capture.records.filter(
      (record) => record.event === 'request.failed' || record.level === 50
    );
    expect(failures).toHaveLength(1);
    const failure = failures[0] as {
      err: { message: string; stack: string };
      errorCode: string;
      outcome: string;
      statusCode: number;
      msg: string;
      reqId: string;
    };
    expect(failure.err.message).toBe('gitea exploded');
    expect(failure.err.stack).toContain('gitea exploded');
    expect(failure.errorCode).toBe('internalError');
    expect(failure.outcome).toBe('failed');
    expect(failure.statusCode).toBe(500);
    expect(failure.reqId).toEqual(expect.any(String));
    // msg 必须是固定英文事件描述，而不是异常原文（US24）。
    expect(failure.msg).toBe('Request failed');
  });

  it('leaves an ordinary 4xx to the request completion log', async () => {
    const capture = createLogCapture();
    app = buildWithLogger(capture.logger);

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'wrong' }
    });

    expect(response.statusCode).toBe(401);
    // 客户端错误不该被升级成服务端异常日志（US10）。
    expect(capture.records.filter((record) => record.level === 50)).toHaveLength(0);
    expect(capture.records.some((record) => record.msg === 'request completed')).toBe(true);
  });

  it('records a failed login at warn without escalating it to an error', async () => {
    const capture = createLogCapture();
    app = buildWithLogger(capture.logger);

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'wrong-password' }
    });

    expect(response.statusCode).toBe(401);
    const security = capture.records.filter((record) => record.event === 'auth.login');
    expect(security).toHaveLength(1);
    expect(security[0]).toMatchObject({
      level: 40,
      outcome: 'failed',
      actorUsername: 'alice',
      errorCode: 'unauthorizedInvalidCredentials'
    });
    expect(capture.records.filter((record) => record.level === 50)).toHaveLength(0);
  });

  it('records a rejected password change at warn', async () => {
    const capture = createLogCapture();
    app = buildWithLogger(capture.logger, {
      validateToken: vi.fn().mockResolvedValue({ id: 1, username: 'alice', email: 'alice@local.esl' }),
      validateUserPassword: vi.fn().mockResolvedValue(false)
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: { authorization: 'token valid-token' },
      payload: { oldPassword: 'wrong', newPassword: 'brand-new-password' }
    });

    expect(response.statusCode).toBe(401);
    const security = capture.records.filter((record) => record.event === 'auth.password-change');
    expect(security).toHaveLength(1);
    expect(security[0]).toMatchObject({
      level: 40,
      outcome: 'failed',
      actorUsername: 'alice',
      errorCode: 'unauthorizedCurrentPasswordIsIncorrect'
    });
    expect(JSON.stringify(capture.records)).not.toContain('brand-new-password');
  });

  it('does not create security events for an ordinary successful read', async () => {
    const capture = createLogCapture();
    app = buildWithLogger(capture.logger);

    await app.inject({ method: 'GET', url: anonymousEndpoint });

    // 普通读请求只留请求完成日志，不额外产出业务/安全事件（US18）。
    expect(requestRecords(capture).filter((record) => record.event !== undefined)).toHaveLength(0);
  });

  it('never writes credentials, full headers or full request bodies', async () => {
    const capture = createLogCapture();
    app = buildWithLogger(capture.logger);

    await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        authorization: 'token top-secret-token',
        cookie: 'esl_session=top-secret-cookie'
      },
      payload: { username: 'alice', password: 'top-secret-password' }
    });

    const serialized = JSON.stringify(capture.records);
    expect(serialized).not.toContain('top-secret-password');
    expect(serialized).not.toContain('top-secret-token');
    expect(serialized).not.toContain('top-secret-cookie');
    for (const record of capture.records) {
      expect(record).not.toHaveProperty('headers');
      expect(record).not.toHaveProperty('body');
      if (record.req !== undefined) {
        expect(record.req).not.toHaveProperty('headers');
        expect(record.req).not.toHaveProperty('body');
      }
    }
  });
});
