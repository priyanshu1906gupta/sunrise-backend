import { spawnSync } from "child_process";
import path from "path";

export function syncPrismaSchema(): void {
  const cwd = path.resolve(__dirname, "../..");
  let prismaCli: string;
  try {
    prismaCli = require.resolve("prisma/build/index.js");
  } catch {
    console.error("Prisma CLI is not installed; skip schema sync.");
    return;
  }
  const result = spawnSync(process.execPath, [prismaCli, "db", "push", "--skip-generate"], {
    cwd,
    env: process.env,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    console.error("prisma db push failed:", (result.stderr || result.stdout || "").slice(0, 2000));
    return;
  }
  console.log("Database schema synced");
}
