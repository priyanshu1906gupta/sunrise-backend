import path from "path";
import fs from "fs";
import { AsyncLocalStorage } from "async_hooks";
import { env } from "../config/env";
import { isPlaceholderEnvValue, resolveWritableUploadRoot } from "./upload-paths";

function normalizePublicPath(value: string): string {
  const trimmed = value.trim().replace(/\\/g, "/");
  if (!trimmed || trimmed === "/") return "/assets";
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}

function publicPathFromImageBase(imageBaseUrl: string): string | null {
  try {
    const pathname = new URL(imageBaseUrl).pathname.replace(/\/+$/, "");
    return pathname ? normalizePublicPath(pathname) : "/uploads";
  } catch {
    return null;
  }
}

function resolvedImageBaseUrl(): string {
  const trimmed = env.IMAGE_BASE_URL.trim().replace(/\/$/, "");
  if (!trimmed || isPlaceholderEnvValue(trimmed)) return "";
  try {
    const parsed = new URL(trimmed);
    if (!parsed.pathname || parsed.pathname === "/") {
      return `${trimmed}/uploads`;
    }
    return trimmed;
  } catch {
    return trimmed;
  }
}

const IMAGE_BASE = resolvedImageBaseUrl();

/** Disk root for uploads. Local: ./assets. GoDaddy AiroApp: ./public/assets (persists across deploys). */
export const UPLOAD_ROOT = resolveWritableUploadRoot(env.UPLOAD_BASE_DIR);

/** URL path Express serves (local /assets, cPanel /uploads). */
export const UPLOAD_PUBLIC_PATH =
  (IMAGE_BASE ? publicPathFromImageBase(IMAGE_BASE) : null) || normalizePublicPath(env.UPLOAD_URL_PATH);

const publicUrlContext = new AsyncLocalStorage<string>();

export function runWithPublicUrl(publicUrl: string, next: () => void): void {
  publicUrlContext.run(publicUrl.replace(/\/$/, ""), next);
}

export function ensureUploadRoot(): string {
  try {
    fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
  } catch (error) {
    console.error(`Could not create upload directory ${UPLOAD_ROOT}:`, error);
  }
  return UPLOAD_ROOT;
}

export function companyDir(companyId: string): string {
  if (!companyId || /[\\/]/.test(companyId) || companyId.includes("..")) {
    throw new Error("Invalid company id");
  }
  return path.join(UPLOAD_ROOT, companyId);
}

export function ensureCompanyDir(companyId: string): string {
  const dir = companyDir(companyId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function absoluteUploadPath(relativePath: string): string {
  const abs = path.resolve(UPLOAD_ROOT, relativePath);
  const root = path.resolve(UPLOAD_ROOT);
  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Invalid file path");
  }
  return abs;
}

export function fileUrl(relativePath: string, publicBase?: string): string {
  const rel = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (IMAGE_BASE) {
    return `${IMAGE_BASE}/${rel}`;
  }
  const base = (publicBase || publicUrlContext.getStore() || env.PUBLIC_URL).replace(/\/$/, "");
  return `${base}${UPLOAD_PUBLIC_PATH}/${rel}`;
}

export function toNumber(value: unknown): number {
  if (value == null) return 0;
  return Number(value);
}

export function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function daysUntil(date: Date): number {
  const today = startOfDay(new Date());
  const target = startOfDay(date);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export function randomOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}
