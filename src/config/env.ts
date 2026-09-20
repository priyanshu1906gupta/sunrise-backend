import { z } from "zod";

function stripEnvQuotes(value: unknown): string {
  return String(value ?? "").trim().replace(/^['"]+|['"]+$/g, "");
}

const envSchema = z.object({
  PORT: z.preprocess((value) => (value === "" || value == null ? undefined : value), z.coerce.number().default(3000)),
  NODE_ENV: z.preprocess(
    (value) => String(value ?? "development").toLowerCase(),
    z.enum(["development", "production", "test"]).default("development"),
  ),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.preprocess(
    (value) => (value === "" || value == null ? undefined : value),
    z.string().min(16).default("sunrise-coaching-change-this-jwt-secret"),
  ),
  JWT_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
  IDLE_TIMEOUT_MS: z.coerce.number().default(6 * 60 * 60 * 1000),
  CORS_ORIGIN: z.string().default("http://localhost:4200"),
  FRONTEND_URL: z.string().default("http://localhost:4200"),
  SMTP_HOST: z.preprocess(stripEnvQuotes, z.string().optional().default("")),
  SMTP_PORT: z.preprocess((value) => {
    if (value === "" || value == null) return undefined;
    return stripEnvQuotes(value);
  }, z.coerce.number().optional().default(587)),
  SMTP_USER: z.preprocess(stripEnvQuotes, z.string().optional().default("")),
  SMTP_PASS: z.preprocess(stripEnvQuotes, z.string().optional().default("")),
  SMTP_APP_PASS: z.preprocess(stripEnvQuotes, z.string().optional().default("")),
  SMTP_FROM: z.preprocess(stripEnvQuotes, z.string().optional().default("Sunrise Coaching Khargone <noreply@sunrise.local>")),
  SUPPORT_EMAIL: z.preprocess(
    (value) => (value === "" || value == null ? undefined : value),
    z.string().email().default("admin@online-business-erp.com"),
  ),
  SUPPORT_PHONE: z.preprocess(
    (value) => (value === "" || value == null ? undefined : value),
    z.string().min(1).default("7898356505"),
  ),
  PUBLIC_URL: z.string().default("http://localhost:3000"),
  UPLOAD_BASE_DIR: z.string().default("./assets"),
  IMAGE_BASE_URL: z.string().optional().default(""),
  UPLOAD_URL_PATH: z.string().default("/assets"),
  SUPER_ADMIN_KEY: z.string().min(16).default("884420a297efd8d34a110511522db63efce6ab4a"),
});

const parsed = envSchema.safeParse(process.env);

export const envErrors = parsed.success ? null : parsed.error.flatten().fieldErrors;

if (envErrors) {
  console.error("Invalid environment variables:", envErrors);
  console.error("Set DATABASE_URL and JWT_SECRET in GoDaddy Node.js / cPanel environment variables.");
}

export const env = parsed.success
  ? parsed.data
  : envSchema.parse({
      PORT: process.env.PORT || 3000,
      NODE_ENV: "production",
      DATABASE_URL: "mysql://127.0.0.1:3306/unset",
      JWT_SECRET: "missing-jwt-secret-set-in-hosting",
    });
