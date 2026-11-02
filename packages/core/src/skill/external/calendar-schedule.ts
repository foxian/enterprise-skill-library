import type { ValidationResult } from '../../schema/validation-result.js';

// 外部引用的日历同步计划（ADR-0074）：不用 cron，按每天 / 每周 / 每月的字段描述。
export type CalendarSchedule =
  | DailySchedule
  | WeeklySchedule
  | MonthlySchedule;

interface ScheduleBase {
  time: string; // HH:MM（24 小时制）
  timeZone: string; // IANA 时区，例如 Asia/Shanghai
}

export interface DailySchedule extends ScheduleBase {
  frequency: 'daily';
}

export interface WeeklySchedule extends ScheduleBase {
  frequency: 'weekly';
  weekday: number; // ISO 星期：1=周一 … 7=周日
}

export interface MonthlySchedule extends ScheduleBase {
  frequency: 'monthly';
  dayOfMonth: number; // 1..31；当月不存在时回退到当月最后一天
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function isValidTimeZone(timeZone: string): boolean {
  try {
    // Intl 对非法时区抛 RangeError；用它权威校验。
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function validateCalendarSchedule(input: unknown): ValidationResult<CalendarSchedule> {
  if (!input || typeof input !== 'object') {
    return { success: false, errors: ['schedule must be an object'] };
  }
  const record = input as Record<string, unknown>;
  const errors: string[] = [];
  const frequency = record.frequency;
  const time = record.time;
  const timeZone = record.timeZone;

  if (typeof time !== 'string' || !TIME_PATTERN.test(time)) {
    errors.push('schedule.time must be HH:MM (24-hour)');
  }
  if (typeof timeZone !== 'string' || !isValidTimeZone(timeZone)) {
    errors.push('schedule.timeZone must be a valid IANA time zone');
  }
  if (frequency !== 'daily' && frequency !== 'weekly' && frequency !== 'monthly') {
    errors.push('schedule.frequency must be daily, weekly or monthly');
    return { success: false, errors };
  }
  if (frequency === 'weekly') {
    const weekday = record.weekday;
    if (typeof weekday !== 'number' || !Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
      errors.push('schedule.weekday must be an integer 1..7');
    }
  }
  if (frequency === 'monthly') {
    const dayOfMonth = record.dayOfMonth;
    if (typeof dayOfMonth !== 'number' || !Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
      errors.push('schedule.dayOfMonth must be an integer 1..31');
    }
  }
  if (errors.length > 0) return { success: false, errors };

  if (frequency === 'daily') {
    return { success: true, data: { frequency, time: time as string, timeZone: timeZone as string } };
  }
  if (frequency === 'weekly') {
    return {
      success: true,
      data: { frequency, weekday: record.weekday as number, time: time as string, timeZone: timeZone as string }
    };
  }
  return {
    success: true,
    data: { frequency, dayOfMonth: record.dayOfMonth as number, time: time as string, timeZone: timeZone as string }
  };
}

// ── 时区换算 ───────────────────────────────────────────────────────────────

// 把某时区里的挂钟时间（年/月/日/时/分）转换成 UTC Date。通过读取偏移量并迭代
// 修正实现，兼容夏令时（春秋切换日偏移量非整点时仍收敛）。
function zonedWallTimeToUtc(
  year: number,
  month: number, // 1..12
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  // 先按 UTC 猜一个实例。
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 3; i += 1) {
    const offset = getOffsetMinutes(new Date(utc), timeZone);
    const corrected = Date.UTC(year, month - 1, day, hour, minute, 0) - offset * 60_000;
    if (corrected === utc) break;
    utc = corrected;
  }
  return new Date(utc);
}

// 返回 timeZone 相对 UTC 的偏移分钟数（UTC - wall），例如 UTC+8 → -480。
function getOffsetMinutes(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(instant);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour) === 24 ? 0 : Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

// 用指定时区读取某个 instant 的挂钟年月日时分。
function zonedParts(instant: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(instant);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) === 24 ? 0 : Number(map.hour),
    minute: Number(map.minute)
  };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function parseTime(time: string): { hour: number; minute: number } {
  const match = TIME_PATTERN.exec(time);
  return { hour: Number(match![1]), minute: Number(match![2]) };
}

// 计算从 from 开始（不含已过去的同一时刻）下一次计划检查的 UTC 时刻。
export function nextScheduledCheck(schedule: CalendarSchedule, from: Date = new Date()): Date {
  const { hour, minute } = parseTime(schedule.time);
  const here = zonedParts(from, schedule.timeZone);

  if (schedule.frequency === 'daily') {
    const today = zonedWallTimeToUtc(here.year, here.month, here.day, hour, minute, schedule.timeZone);
    if (today.getTime() > from.getTime()) return today;
    const nextDay = new Date(Date.UTC(here.year, here.month - 1, here.day + 1));
    return zonedWallTimeToUtc(nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1, nextDay.getUTCDate(), hour, minute, schedule.timeZone);
  }

  if (schedule.frequency === 'weekly') {
    // JS: 周日=0..周六=6；ISO: 周一=1..周日=7。
    const jsDay = new Date(Date.UTC(here.year, here.month - 1, here.day)).getUTCDay();
    const todayIso = jsDay === 0 ? 7 : jsDay;
    let delta = schedule.weekday - todayIso;
    const candidateToday = zonedWallTimeToUtc(here.year, here.month, here.day, hour, minute, schedule.timeZone);
    if (delta < 0 || (delta === 0 && candidateToday.getTime() <= from.getTime())) {
      delta += 7;
    }
    const target = new Date(Date.UTC(here.year, here.month - 1, here.day + delta));
    return zonedWallTimeToUtc(target.getUTCFullYear(), target.getUTCMonth() + 1, target.getUTCDate(), hour, minute, schedule.timeZone);
  }

  // monthly
  const effectiveDay = Math.min(schedule.dayOfMonth, daysInMonth(here.year, here.month));
  const candidate = zonedWallTimeToUtc(here.year, here.month, effectiveDay, hour, minute, schedule.timeZone);
  if (candidate.getTime() > from.getTime()) return candidate;
  const nextMonthYear = here.month === 12 ? here.year + 1 : here.year;
  const nextMonth = here.month === 12 ? 1 : here.month + 1;
  const fallbackDay = Math.min(schedule.dayOfMonth, daysInMonth(nextMonthYear, nextMonth));
  return zonedWallTimeToUtc(nextMonthYear, nextMonth, fallbackDay, hour, minute, schedule.timeZone);
}

// 供界面/日志使用的简短摘要；保持与实现解耦，不暴露内部字段名。
export function describeSchedule(schedule: CalendarSchedule): string {
  const timeZone = schedule.timeZone;
  if (schedule.frequency === 'daily') {
    return `daily at ${schedule.time} (${timeZone})`;
  }
  if (schedule.frequency === 'weekly') {
    return `weekly on weekday ${schedule.weekday} at ${schedule.time} (${timeZone})`;
  }
  return `monthly on day ${schedule.dayOfMonth} at ${schedule.time} (${timeZone})`;
}
