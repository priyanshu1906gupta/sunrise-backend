import { Prisma } from "@prisma/client";
import { env, envErrors } from "../config/env";

const CONFIG_HINT =
  "Database is not configured. Open Settings → Hosted Database → Open database guide, then add DATABASE_URL under Settings → Secrets (or rely on DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT).";

export function hasHostedDbVars(): boolean {
  return Boolean(
    process.env.DB_HOST ||
      process.env.MYSQL_HOST ||
      process.env.MYSQLHOST,
  ) && Boolean(process.env.DB_USER || process.env.MYSQL_USER || process.env.MYSQLUSER) && Boolean(
    process.env.DB_NAME || process.env.MYSQL_DATABASE || process.env.MYSQL_DB,
  );
}

export function databaseUrlLooksUsable(): boolean {
  if (hasHostedDbVars()) return true;
  const url = process.env.DATABASE_URL || env.DATABASE_URL || "";
  if (!url || envErrors?.DATABASE_URL) return false;
  if (url.includes("YOUR_DB") || url.includes("/unset") || url.includes("invalid")) return false;
  return true;
}

export function databaseUrlIsLocalhost(): boolean {
  const url = process.env.DATABASE_URL || env.DATABASE_URL || "";
  return /localhost|127\.0\.0\.1/i.test(url);
}

function connectionHint(): string {
  if (!databaseUrlLooksUsable()) return CONFIG_HINT;
  if (databaseUrlIsLocalhost()) {
    return "This host cannot reach MySQL at localhost. Use the Hosted Database connection string, not 127.0.0.1.";
  }
  return "Cannot connect to MySQL. Check DATABASE_URL / DB_* secrets and that the hosted database is running.";
}

export function prismaFailureMessage(err: unknown): string | null {
  const code =
    err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code) : "";
  const name = err && typeof err === "object" && "name" in err ? String((err as { name?: string }).name) : "";

  if (
    name === "PrismaClientInitializationError" ||
    code === "P1000" ||
    code === "P1001" ||
    code === "P1002" ||
    code === "P1017" ||
    code === "P1013"
  ) {
    return connectionHint();
  }

  if (code === "P1003" || code === "P2021" || code === "P2022") {
    return "Connected to MySQL but tables are missing. Redeploy so the app can run prisma db push, or use Hosted Database → Import SQL.";
  }

  const text = err instanceof Error ? err.message : "";
  if (/can't reach database|connection refused|connect econnrefused|p1001/i.test(text)) {
    return connectionHint();
  }
  if (/does not exist|p2021/i.test(text)) {
    return "Connected to MySQL but tables are missing. Redeploy so the app can run prisma db push, or use Hosted Database → Import SQL.";
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return null;
  }

  return null;
}
