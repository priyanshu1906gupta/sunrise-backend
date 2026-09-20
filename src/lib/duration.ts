export function durationMs(spec: string, fallbackMs: number): number {
  const match = /^(\d+)\s*([smhd])$/i.exec(spec.trim());
  if (!match) return fallbackMs;
  const n = Number(match[1]);
  const unit = match[2].toLowerCase();
  const mult = unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return n * mult;
}
