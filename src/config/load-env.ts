import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { applyUploadStorage } from "../lib/upload-paths";

const cwd = process.cwd();
const envPath = path.join(cwd, ".env");
const productionPath = path.join(cwd, ".env.production");
const isProduction = (process.env.NODE_ENV || "").toLowerCase() === "production";

function isLocalOrPlaceholderUrl(url: string | undefined): boolean {
  if (!url?.trim()) return true;
  return /localhost|127\.0\.0\.1|YOUR_DB|YOUR_MYSQL|\/unset\b/i.test(url);
}

function isPlaceholderSecret(value: string | undefined): boolean {
  const v = value?.trim() ?? "";
  if (!v) return true;
  return /^(YOUR_|CHANGE_ME)/i.test(v) || /YOUR_DOMAIN|YOUR_SMTP|YOUR_MAILBOX/i.test(v);
}

/** Local XAMPP .env must not load on AiroApp — it points at 127.0.0.1. */
if (!isProduction && fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

if (fs.existsSync(productionPath)) {
  dotenv.config({ path: productionPath, override: false });
}

/** Hosted Secrets win over the file unless we copy SMTP from .env.production (stale Titan keys are common). */
function applyProductionSmtpFromFile(): void {
  if (!fs.existsSync(productionPath)) return;
  let parsed: Record<string, string> = {};
  try {
    parsed = dotenv.parse(fs.readFileSync(productionPath, "utf8"));
  } catch {
    return;
  }
  const keys = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_APP_PASS", "SMTP_FROM", "SUPPORT_EMAIL", "SUPPORT_PHONE"];
  for (const key of keys) {
    const value = parsed[key]?.trim().replace(/^['"]+|['"]+$/g, "");
    if (value && !isPlaceholderSecret(value)) process.env[key] = value;
  }
}

function stripPlaceholderSmtp(): void {
  const keys = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_APP_PASS", "SMTP_FROM"];
  for (const key of keys) {
    const current = process.env[key];
    if (!current?.trim()) continue;
    if (isPlaceholderSecret(current)) {
      console.warn(`[mail] Ignoring placeholder ${key}=${current}`);
      delete process.env[key];
    }
  }
}

applyProductionSmtpFromFile();
stripPlaceholderSmtp();

function hostedDbParts() {
  const host = (process.env.DB_HOST || process.env.MYSQL_HOST || process.env.MYSQLHOST || "").trim();
  const user = (process.env.DB_USER || process.env.MYSQL_USER || process.env.MYSQLUSER || "").trim();
  const name = (process.env.DB_NAME || process.env.MYSQL_DATABASE || process.env.MYSQL_DB || "").trim();
  const password = process.env.DB_PASSWORD ?? process.env.MYSQL_PASSWORD ?? process.env.MYSQLPASSWORD ?? "";
  const port = (process.env.DB_PORT || process.env.MYSQL_PORT || "3306").trim();
  return { host, user, name, password, port };
}

/** Prefer GoDaddy Hosted Database. Ignore localhost DATABASE_URL from a copied .env. */
export function applyHostedDatabaseUrl(): void {
  const { host, user, name, password, port } = hostedDbParts();
  const existing = process.env.DATABASE_URL?.trim();

  if (host && user && name && (isLocalOrPlaceholderUrl(existing) || !existing)) {
    process.env.DATABASE_URL = `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(name)}`;
    console.log(`MySQL: using hosted database ${host}:${port}/${name}`);
    return;
  }

  if (isProduction && existing && isLocalOrPlaceholderUrl(existing)) {
    console.error("Ignoring localhost DATABASE_URL. Set the Hosted Database connection string in Settings → Secrets.");
    delete process.env.DATABASE_URL;
  }
}

applyHostedDatabaseUrl();
applyUploadStorage();
