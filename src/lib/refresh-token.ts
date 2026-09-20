import crypto from "crypto";
import { prisma } from "./prisma";
import { env } from "../config/env";
import { durationMs } from "./duration";
import { AppError } from "../middleware/errorHandler";

const ACTIVITY_TOUCH_MS = 60_000;

export function hashRefreshToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function newRefreshToken(): string {
  return crypto.randomBytes(48).toString("hex");
}

export async function issueRefreshToken(userId: string, lastUsedAt = new Date()): Promise<string> {
  const raw = newRefreshToken();
  const now = new Date();
  const ttl = durationMs(env.JWT_REFRESH_EXPIRES_IN, 7 * 86_400_000);
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashRefreshToken(raw),
      expiresAt: new Date(now.getTime() + ttl),
      lastUsedAt,
    },
  });
  return raw;
}

export async function rotateRefreshToken(userId: string, currentRaw: string): Promise<string> {
  const currentHash = hashRefreshToken(currentRaw);
  const current = await prisma.refreshToken.findFirst({
    where: { userId, tokenHash: currentHash, revokedAt: null },
    select: { lastUsedAt: true },
  });
  await prisma.refreshToken.updateMany({
    where: { userId, tokenHash: currentHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return issueRefreshToken(userId, current?.lastUsedAt ?? new Date());
}

export async function revokeRefreshToken(raw: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashRefreshToken(raw), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function findValidRefreshToken(raw: string) {
  const row = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashRefreshToken(raw) },
    include: { user: true },
  });
  if (!row || row.revokedAt) return null;
  if (row.expiresAt < new Date()) return null;
  if (isIdleSince(row.lastUsedAt)) return null;
  return row;
}

export async function assertSessionActive(userId: string, opts?: { touch?: boolean }): Promise<void> {
  const row = await prisma.refreshToken.findFirst({
    where: { userId, revokedAt: null },
    orderBy: { lastUsedAt: "desc" },
    select: { lastUsedAt: true },
  });
  if (!row || isIdleSince(row.lastUsedAt)) {
    throw new AppError(401, "Session expired. Please log in again.", "SESSION_EXPIRED");
  }
  if (!opts?.touch) return;
  if (Date.now() - row.lastUsedAt.getTime() < ACTIVITY_TOUCH_MS) return;
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { lastUsedAt: new Date() },
  });
}

function isIdleSince(lastUsedAt: Date): boolean {
  return Date.now() - lastUsedAt.getTime() > env.IDLE_TIMEOUT_MS;
}
