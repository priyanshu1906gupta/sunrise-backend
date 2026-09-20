import fs from "fs";
import path from "path";

/** GoDaddy Node.js Hosting (AiroApp) keeps files across deploys in this folder. */
export const AIROAPP_UPLOAD_DIR = path.join("public", "assets");

export function isPlaceholderEnvValue(value: string | undefined): boolean {
  const v = (value || "").trim();
  if (!v) return false;
  return /\[internal\]|YOUR_|CHANGE_ME|placeholder/i.test(v);
}

function canWriteDir(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function toAbsolute(dir: string, cwd: string): string {
  return path.isAbsolute(dir) ? dir : path.resolve(cwd, dir);
}

/**
 * Pick a writable upload root. Ignores GoDaddy `[internal]` and copied YOUR_* examples.
 * On AiroApp the persistent path is `{cwd}/public/assets`.
 */
export function resolveWritableUploadRoot(configured: string | undefined, cwd = process.cwd()): string {
  const candidates: string[] = [];
  const trimmed = (configured || "").trim();

  if (trimmed && !isPlaceholderEnvValue(trimmed)) {
    candidates.push(toAbsolute(trimmed, cwd));
  }

  const publicAssets = path.join(cwd, "public", "assets");
  const localAssets = path.resolve(cwd, "assets");
  const isAiroApp = cwd === "/app" || isPlaceholderEnvValue(trimmed);
  const isProduction = (process.env.NODE_ENV || "").toLowerCase() === "production";

  if (isAiroApp || isProduction) {
    candidates.push(publicAssets);
  }
  candidates.push(localAssets);

  const unique = [...new Set(candidates)];
  const chosen = unique.find(canWriteDir);
  if (chosen) return chosen;

  try {
    fs.mkdirSync(localAssets, { recursive: true });
  } catch {
    /* boot must continue even if the first mkdir fails */
  }
  return localAssets;
}

/** Clear copy-paste placeholders before env.ts parses process.env. */
export function applyUploadStorage(): void {
  const previous = (process.env.UPLOAD_BASE_DIR || "").trim();
  const chosen = resolveWritableUploadRoot(previous);

  process.env.UPLOAD_BASE_DIR = chosen;

  if (isPlaceholderEnvValue(process.env.IMAGE_BASE_URL)) {
    process.env.IMAGE_BASE_URL = "";
  }
  if (isPlaceholderEnvValue(process.env.PUBLIC_URL)) {
    delete process.env.PUBLIC_URL;
  }

  const usingPublicAssets = path.resolve(chosen) === path.resolve(process.cwd(), "public", "assets");
  if (usingPublicAssets) {
    process.env.UPLOAD_URL_PATH = "/assets";
  }

  if (previous && path.resolve(previous) !== path.resolve(chosen) && isPlaceholderEnvValue(previous)) {
    console.log(`Uploads: ignoring ${previous}, using ${chosen}`);
  }
}
