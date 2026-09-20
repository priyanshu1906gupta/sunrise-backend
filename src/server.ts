import "./config/load-env";
import type { Express } from "express";
import app from "./app";
import { env, envErrors } from "./config/env";
import { isSmtpConfigured } from "./lib/mailer";
import { prisma } from "./lib/prisma";
import { UPLOAD_PUBLIC_PATH, UPLOAD_ROOT } from "./lib/files";
import { syncPrismaSchema } from "./lib/sync-schema";
import { databaseUrlLooksUsable } from "./lib/prisma-errors";

declare const PhusionPassenger: { configure: (opts: { autoInstall: boolean }) => void } | undefined;

function listen(expressApp: Express): Promise<void> {
  const port = Number(process.env.PORT) || env.PORT || 3000;
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);

    if (typeof PhusionPassenger !== "undefined") {
      PhusionPassenger.configure({ autoInstall: false });
      const server = (expressApp.listen as (bind: string, cb: () => void) => { on: (ev: string, fn: (err: Error) => void) => void })(
        "passenger",
        () => resolve(),
      );
      server.on("error", onError);
      return;
    }

    const server = expressApp.listen(port, "0.0.0.0", () => {
      console.log(`Server running on port ${port}`);
      console.log(
        `Uploads: ${UPLOAD_ROOT} (public ${env.IMAGE_BASE_URL || `http://localhost:${port}${UPLOAD_PUBLIC_PATH}`})`,
      );
      if (isSmtpConfigured()) {
        console.log(`SMTP: ${env.SMTP_USER} via ${env.SMTP_HOST}:${env.SMTP_PORT}`);
      } else {
        console.warn("SMTP: not configured (Publish secrets still have YOUR_SMTP_* placeholders, or SMTP_PASS is empty)");
      }
      resolve();
    });
    server.on("error", onError);
  });
}

async function main() {
  await listen(app);

  if (!databaseUrlLooksUsable()) {
    console.error("No DATABASE_URL or DB_* hosted-database variables. Login will fail until those are set.");
    if (envErrors) console.error("Other env issues:", envErrors);
    return;
  }

  try {
    syncPrismaSchema();
    await prisma.$connect();
    console.log("Database connected successfully");
  } catch (error) {
    console.error("Database connection failed (process will stay running):", error);
  }
}

main().catch((error) => {
  console.error("Failed to start server:", error);
});

const shutdown = async () => {
  try {
    await prisma.$disconnect();
  } finally {
    process.exit(0);
  }
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
