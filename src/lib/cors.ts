import { env } from "../config/env";
import type { CorsOptions } from "cors";

function configuredOrigins(): string[] {
  return env.CORS_ORIGIN.split(",").map((value) => value.trim()).filter(Boolean);
}

export function isOriginAllowed(origin?: string | null): boolean {
  if (env.NODE_ENV !== "production") return true;
  if (!origin) return true;
  const allowed = configuredOrigins();
  if (allowed.includes("*") || allowed.includes(origin)) return true;
  try {
    const host = new URL(origin).hostname;
    if (host === "localhost" || host === "127.0.0.1") return true;
  } catch {
    /* ignore */
  }
  return origin.startsWith("capacitor://") || origin.startsWith("ionic://");
}

export function corsOptions(): CorsOptions {
  return {
    origin(origin, callback) {
      if (isOriginAllowed(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
  };
}
