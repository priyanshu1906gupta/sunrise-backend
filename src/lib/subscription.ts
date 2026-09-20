import crypto from "crypto";
import { prisma } from "./prisma";
import { env } from "../config/env";
import { AppError } from "../middleware/errorHandler";
import { addMonths, daysUntil, startOfDay } from "./files";

export const SUBSCRIPTION_ENDED_MSG =
  "Your subscription has ended. Kindly contact the Admin to renew it.";
export const ACCOUNT_DEACTIVATED_MSG =
  "Your account is deactivated. Kindly contact the administrator.";

export const EXTEND_MONTHS = [1, 2, 3, 6, 12] as const;
export type ExtendMonths = (typeof EXTEND_MONTHS)[number];

export function defaultSubscriptionDates(from = new Date()) {
  return {
    subscriptionStartAt: from,
    subscriptionEndAt: addMonths(from, 2),
  };
}

export function daysLeft(end: Date): number {
  return Math.max(0, daysUntil(end));
}

export function isSubscriptionCurrent(end: Date): boolean {
  return startOfDay(end).getTime() >= startOfDay(new Date()).getTime();
}

export function extendFrom(currentEnd: Date, months: number, now = new Date()): Date {
  const base = startOfDay(currentEnd).getTime() >= startOfDay(now).getTime() ? currentEnd : now;
  return addMonths(base, months);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function toSubscriptionDto(company: {
  id: string;
  name: string;
  ownerName: string;
  phone: string;
  subscriptionStartAt: Date;
  subscriptionEndAt: Date;
  active: boolean;
}) {
  return {
    companyId: company.id,
    companyName: company.name,
    ownerName: company.ownerName,
    phone: company.phone,
    subscriptionStartAt: company.subscriptionStartAt,
    subscriptionEndAt: company.subscriptionEndAt,
    daysLeft: daysLeft(company.subscriptionEndAt),
    active: company.active,
    ended: !isSubscriptionCurrent(company.subscriptionEndAt),
  };
}

export function assertCompanyAccess(company: { active: boolean; subscriptionEndAt: Date } | null): void {
  if (!company) {
    throw new AppError(401, "Authentication required");
  }
  if (!company.active) {
    throw new AppError(403, ACCOUNT_DEACTIVATED_MSG, "ACCOUNT_DEACTIVATED");
  }
  if (!isSubscriptionCurrent(company.subscriptionEndAt)) {
    throw new AppError(403, SUBSCRIPTION_ENDED_MSG, "SUBSCRIPTION_ENDED");
  }
}

export async function assertCompanyCanAccess(companyId: string): Promise<void> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { active: true, subscriptionEndAt: true },
  });
  assertCompanyAccess(company);
}

export function requireSuperAdminKey(provided?: string | string[]): void {
  const key = Array.isArray(provided) ? provided[0] : provided;
  const expected = env.SUPER_ADMIN_KEY;
  if (!key || !expected) {
    throw new AppError(404, "Not found");
  }
  const a = Buffer.from(key);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new AppError(404, "Not found");
  }
}

export async function revokeCompanySessions(companyId: string): Promise<void> {
  const users = await prisma.user.findMany({ where: { companyId }, select: { id: true } });
  if (!users.length) return;
  await prisma.refreshToken.updateMany({
    where: { userId: { in: users.map((u) => u.id) }, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
