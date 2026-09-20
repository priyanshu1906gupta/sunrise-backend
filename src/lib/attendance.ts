import { AttendanceStatus } from "@prisma/client";
import { money } from "./student-billing";

export type AttendanceMark = AttendanceStatus | null;

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function ymdFromUtc(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/** Prisma MySQL DATE may arrive as UTC midnight or as local midnight (IST = previous day 18:30Z). */
export function ymdFromDateOnly(date: Date): string {
  if (
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  ) {
    return ymdFromUtc(date);
  }
  const rounded = new Date(date.getTime() + 12 * 60 * 60 * 1000);
  return ymdFromUtc(rounded);
}

export function utcFromYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function todayYmdLocal(now = new Date()): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

export function addCalendarMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function compareYmd(a: string, b: string): number {
  return a.localeCompare(b);
}

export function monthStartUtc(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 1));
}

export function monthEndUtc(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 0));
}

export function monthKey(year: number, month: number): string {
  return `${year}-${pad2(month)}`;
}

export function compareMonth(a: { year: number; month: number }, b: { year: number; month: number }): number {
  return monthKey(a.year, a.month).localeCompare(monthKey(b.year, b.month));
}

export function clampMonth(
  requested: { year: number; month: number },
  min: { year: number; month: number },
  max: { year: number; month: number },
): { year: number; month: number } {
  if (compareMonth(requested, min) < 0) return min;
  if (compareMonth(requested, max) > 0) return max;
  return requested;
}

export function isSundayUtc(date: Date): boolean {
  return date.getUTCDay() === 0;
}

export type CellLock = "beforeJoin" | "weekend" | "readonly" | null;

export function resolveCell(input: {
  dateYmd: string;
  joiningYmd: string;
  todayYmd: string;
  sundayWeekend: boolean;
  stored: AttendanceStatus | undefined;
  canEdit: boolean;
}): { status: AttendanceMark; locked: boolean; lockReason: CellLock; isFuture: boolean } {
  const isFuture = compareYmd(input.dateYmd, input.todayYmd) > 0;
  if (compareYmd(input.dateYmd, input.joiningYmd) < 0) {
    return { status: null, locked: true, lockReason: "beforeJoin", isFuture };
  }
  if (input.sundayWeekend && isSundayUtc(utcFromYmd(input.dateYmd))) {
    return { status: "WEEKEND", locked: true, lockReason: "weekend", isFuture };
  }
  if (!input.canEdit) {
    const status = input.stored ?? (isFuture ? null : "AVAILABLE");
    return { status, locked: true, lockReason: "readonly", isFuture };
  }
  if (input.stored) {
    return { status: input.stored, locked: false, lockReason: null, isFuture };
  }
  if (isFuture) {
    return { status: null, locked: false, lockReason: null, isFuture };
  }
  return { status: "AVAILABLE", locked: false, lockReason: null, isFuture };
}

export function payableFromStatuses(salary: number, statuses: AttendanceMark[]): number {
  let present = 0;
  let working = 0;
  for (const status of statuses) {
    if (status == null || status === "HOLIDAY_CLOSE" || status === "WEEKEND") continue;
    working += 1;
    if (status === "AVAILABLE") present += 1;
    else if (status === "HALF_LEAVE") present += 0.5;
  }
  if (working === 0) return 0;
  return money((salary * present) / working);
}

export const MANUAL_ATTENDANCE = ["AVAILABLE", "LEAVE", "HALF_LEAVE", "HOLIDAY_CLOSE"] as const;
export type ManualAttendance = (typeof MANUAL_ATTENDANCE)[number];
