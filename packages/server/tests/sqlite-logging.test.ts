import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classifySqliteError, initDatabase } from '../src/db/database.js';
import { createLogCapture, recordsForEvent, type LogCapture } from './helpers/log-capture.js';

// 数据访问层的日志契约（ADR-0045）：临时数据库 + 可控故障验证异常分类，
// 且日志里绝不出现 SQL 文本或绑定参数。
describe('SQLite diagnostic log', () => {
  let tmpDir: string;
  let capture: LogCapture;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-sqlite-log-'));
    capture = createLogCapture();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('records a successful open and schema initialization', () => {
    const db = initDatabase(path.join(tmpDir, 'esl.db'), capture.logger);
    db.close();

    expect(recordsForEvent(capture, 'sqlite.open')).toHaveLength(1);
    expect(recordsForEvent(capture, 'sqlite.open')[0]).toMatchObject({
      outcome: 'succeeded',
      level: 20
    });
    const schema = recordsForEvent(capture, 'sqlite.schema');
    expect(schema).toHaveLength(1);
    expect(schema[0]).toMatchObject({ outcome: 'succeeded' });
    expect(typeof schema[0].durationMs).toBe('number');
  });

  it('records a failed open with a classified error code', () => {
    // 指向一个不存在的目录：better-sqlite3 无法创建数据库文件。
    const missing = path.join(tmpDir, 'no-such-dir', 'esl.db');

    expect(() => initDatabase(missing, capture.logger)).toThrow();

    const opens = recordsForEvent(capture, 'sqlite.open');
    expect(opens).toHaveLength(1);
    expect(opens[0]).toMatchObject({ outcome: 'failed', level: 50 });
    expect(typeof opens[0].errorCode).toBe('string');
    expect(opens[0].err).toBeDefined();
  });

  it('classifies lock, corruption and unknown failures as stable infrastructure codes', () => {
    expect(classifySqliteError({ code: 'SQLITE_BUSY' })).toBe('sqliteLocked');
    expect(classifySqliteError({ code: 'SQLITE_LOCKED' })).toBe('sqliteLocked');
    expect(classifySqliteError({ code: 'SQLITE_CORRUPT' })).toBe('sqliteCorrupt');
    expect(classifySqliteError({ code: 'SQLITE_NOTADB' })).toBe('sqliteNotADatabase');
    expect(classifySqliteError(new Error('something else'))).toBe('sqliteError');
  });

  it('never writes SQL statements or bound parameters', () => {
    const db = initDatabase(path.join(tmpDir, 'esl.db'), capture.logger);
    db.close();

    const serialized = JSON.stringify(capture.records);
    for (const sqlFragment of [
      'CREATE TABLE',
      'ALTER TABLE',
      'INSERT OR IGNORE',
      'UPDATE skills',
      'SELECT ',
      'platform_settings'
    ]) {
      expect(serialized).not.toContain(sqlFragment);
    }
  });

  it('stays silent when no logger is supplied', () => {
    const db = initDatabase(path.join(tmpDir, 'quiet.db'));
    db.close();

    expect(capture.records).toHaveLength(0);
  });
});
