import { env } from "../config/env";
import type { CorsOptions } from "cors";

function configuredOrigins(): string[] {
  return env.CORS_ORIGIN.split(",").map((value) => value.trim()).filter(Boolean);
}

export function corsOptions(): CorsOptions {
  if (env.NODE_ENV !== "production") {
    return { origin: true, credentials: true };
  }

  const allowed = configuredOrigins();
  return {
    origin(origin, callback) {
      if (!origin || allowed.includes("*") || allowed.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
  };
}
