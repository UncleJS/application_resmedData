import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const TZ = process.env.NEXT_PUBLIC_TIMEZONE ?? undefined;

/** Format a UTC ISO string / Date → "YYYY-MM-DD HH:mm:ss" in the configured timezone */
export function formatTs(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year:   "numeric",
    month:  "2-digit",
    day:    "2-digit",
    hour:   "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  // en-CA gives "YYYY-MM-DD, HH:mm:ss" — normalise to "YYYY-MM-DD HH:mm:ss"
  return fmt.format(d).replace(",", "");
}

/** Format a UTC ISO string / Date → "YYYY-MM-DD" in the configured timezone */
export function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year:  "numeric",
    month: "2-digit",
    day:   "2-digit",
  }).format(d);
}

/**
 * Convert a UTC epoch millisecond (or ISO string offset from a session start)
 * to "HH:mm" in the configured timezone.
 * Pass epochMs = sessionStartMs + offsetSeconds * 1000.
 */
export function fmtHHMM(epochMs: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour:   "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(epochMs));
}

/**
 * Convert a UTC epoch millisecond to "HH:mm:ss" in the configured timezone.
 */
export function fmtHHMMSS(epochMs: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour:   "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(epochMs));
}

/** AHI severity colour class */
export function ahiColor(ahi: number | null): string {
  if (ahi === null) return "text-muted-foreground";
  if (ahi < 5)  return "text-emerald-400";
  if (ahi < 15) return "text-yellow-400";
  if (ahi < 30) return "text-orange-400";
  return "text-red-500";
}

/** Format minutes as "Xh Ym" */
export function fmtMinutes(min: number | null): string {
  if (min === null || min === undefined) return "—";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
