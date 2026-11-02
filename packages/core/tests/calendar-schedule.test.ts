import { describe, expect, it } from 'vitest';
import {
  describeSchedule,
  nextScheduledCheck,
  validateCalendarSchedule
} from '../src/skill/external/calendar-schedule.js';

describe('validateCalendarSchedule', () => {
  it('接受每日计划', () => {
    const result = validateCalendarSchedule({
      frequency: 'daily',
      time: '09:30',
      timeZone: 'Asia/Shanghai'
    });
    expect(result.success).toBe(true);
  });

  it('接受每周计划', () => {
    const result = validateCalendarSchedule({
      frequency: 'weekly',
      weekday: 1,
      time: '08:00',
      timeZone: 'UTC'
    });
    expect(result.success).toBe(true);
  });

  it('接受每月计划', () => {
    const result = validateCalendarSchedule({
      frequency: 'monthly',
      dayOfMonth: 31,
      time: '23:59',
      timeZone: 'America/New_York'
    });
    expect(result.success).toBe(true);
  });

  it('拒绝非法时间格式', () => {
    const result = validateCalendarSchedule({
      frequency: 'daily',
      time: '9点半',
      timeZone: 'UTC'
    });
    expect(result.success).toBe(false);
  });

  it('拒绝非法时区', () => {
    const result = validateCalendarSchedule({
      frequency: 'daily',
      time: '09:00',
      timeZone: 'Not/AZone'
    });
    expect(result.success).toBe(false);
  });

  it('每周计划缺少 weekday 时拒绝', () => {
    const result = validateCalendarSchedule({
      frequency: 'weekly',
      time: '09:00',
      timeZone: 'UTC'
    });
    expect(result.success).toBe(false);
  });

  it('每月计划 dayOfMonth 超出范围时拒绝', () => {
    const result = validateCalendarSchedule({
      frequency: 'monthly',
      dayOfMonth: 32,
      time: '09:00',
      timeZone: 'UTC'
    });
    expect(result.success).toBe(false);
  });
});

describe('nextScheduledCheck', () => {
  it('每日计划：返回下一个当天之后的指定时刻', () => {
    // 2026-11-02 是周一，UTC 00:00。当天 09:00 尚未到达。
    const from = new Date('2026-11-02T00:00:00Z');
    const next = nextScheduledCheck(
      { frequency: 'daily', time: '09:00', timeZone: 'UTC' },
      from
    );
    expect(next.toISOString()).toBe('2026-11-02T09:00:00.000Z');
  });

  it('每日计划：时刻已过则顺延一天', () => {
    const from = new Date('2026-11-02T10:00:00Z');
    const next = nextScheduledCheck(
      { frequency: 'daily', time: '09:00', timeZone: 'UTC' },
      from
    );
    expect(next.toISOString()).toBe('2026-11-03T09:00:00.000Z');
  });

  it('每周计划：跳到指定星期几', () => {
    // 2026-11-02 周一。选周五（weekday=5）。
    const from = new Date('2026-11-02T00:00:00Z');
    const next = nextScheduledCheck(
      { frequency: 'weekly', weekday: 5, time: '12:00', timeZone: 'UTC' },
      from
    );
    expect(next.toISOString()).toBe('2026-11-06T12:00:00.000Z');
  });

  it('每周计划：目标星期就是当天且时刻已过，则下周', () => {
    // 周一 10:00，选周一 09:00
    const from = new Date('2026-11-02T10:00:00Z');
    const next = nextScheduledCheck(
      { frequency: 'weekly', weekday: 1, time: '09:00', timeZone: 'UTC' },
      from
    );
    expect(next.toISOString()).toBe('2026-11-09T09:00:00.000Z');
  });

  it('每月计划：当月指定日期尚未到达', () => {
    const from = new Date('2026-11-02T00:00:00Z');
    const next = nextScheduledCheck(
      { frequency: 'monthly', dayOfMonth: 15, time: '08:30', timeZone: 'UTC' },
      from
    );
    expect(next.toISOString()).toBe('2026-11-15T08:30:00.000Z');
  });

  it('每月计划：日期在当月不存在时回退到当月最后一天（2 月 31 日）', () => {
    // 2027-02 是平年，只有 28 天。从 2 月 1 日出发选 31 日 → 2/28。
    const from = new Date('2027-02-01T00:00:00Z');
    const next = nextScheduledCheck(
      { frequency: 'monthly', dayOfMonth: 31, time: '09:00', timeZone: 'UTC' },
      from
    );
    expect(next.toISOString()).toBe('2027-02-28T09:00:00.000Z');
  });

  it('每月计划：闰年 2 月 31 日回退到 2/29', () => {
    const from = new Date('2028-02-01T00:00:00Z');
    const next = nextScheduledCheck(
      { frequency: 'monthly', dayOfMonth: 31, time: '09:00', timeZone: 'UTC' },
      from
    );
    expect(next.toISOString()).toBe('2028-02-29T09:00:00.000Z');
  });

  it('每月计划：当月日期与时刻均已过，则下个月', () => {
    const from = new Date('2026-11-20T10:00:00Z');
    const next = nextScheduledCheck(
      { frequency: 'monthly', dayOfMonth: 15, time: '09:00', timeZone: 'UTC' },
      from
    );
    expect(next.toISOString()).toBe('2026-12-15T09:00:00.000Z');
  });

  it('尊重时区：Asia/Shanghai 的 09:00 对应 UTC 01:00', () => {
    const from = new Date('2026-11-02T00:00:00Z');
    const next = nextScheduledCheck(
      { frequency: 'daily', time: '09:00', timeZone: 'Asia/Shanghai' },
      from
    );
    expect(next.toISOString()).toBe('2026-11-02T01:00:00.000Z');
  });

  it('夏令时：America/New_York 夏令时下 09:00 EDT 对应 UTC 13:00', () => {
    // 2027 年 DST 自 3 月 14 日生效；3 月 15 日为 EDT（UTC-4）。
    const from = new Date('2027-03-15T00:00:00Z');
    const next = nextScheduledCheck(
      { frequency: 'daily', time: '09:00', timeZone: 'America/New_York' },
      from
    );
    expect(next.toISOString()).toBe('2027-03-15T13:00:00.000Z');
  });
});

describe('describeSchedule', () => {
  it('给出不含敏感实现细节的可读摘要', () => {
    const text = describeSchedule({
      frequency: 'weekly',
      weekday: 3,
      time: '10:15',
      timeZone: 'Asia/Shanghai'
    });
    expect(text).toContain('10:15');
    expect(text).toContain('Asia/Shanghai');
  });
});
