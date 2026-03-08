import pool from "@/lib/db";
import type { RowDataPacket } from "mysql2";

export interface EventRow {
  id: number;
  event_time_utc: string;
  offset_s: number;
  duration_s: number;
  event_type: string;
}

export interface EventBreakdownRow {
  night: string;
  event_type: string;
  cnt: number;
}

function normDate(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

/**
 * Resolve the configured display timezone to a fixed SQL UTC-offset string
 * (e.g. "Africa/Johannesburg" → "+02:00").  This is needed because MariaDB
 * named-timezone support requires the mysql.time_zone tables to be populated,
 * which may not be the case.  SAST has no DST so a fixed offset is always
 * correct; other zones without DST are handled too.
 *
 * Falls back to "+00:00" if the TZ env var is unset or the offset cannot be
 * determined.
 */
function resolveUtcOffset(tz: string | undefined): string {
  if (!tz) return "+00:00";
  try {
    // Use a winter date (no DST ambiguity) to read the raw offset
    const date = new Date("2026-01-15T12:00:00Z");
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: tz,
      timeZoneName: "shortOffset",
    }).formatToParts(date);
    const offsetPart = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    // offsetPart is like "GMT+2" or "GMT+02:00"
    const m = offsetPart.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!m) return "+00:00";
    const sign  = m[1];
    const hours = m[2]!.padStart(2, "0");
    const mins  = (m[3] ?? "00").padStart(2, "0");
    return `${sign}${hours}:${mins}`;
  } catch {
    return "+00:00";
  }
}

// Resolved once at module load — baked into the build via NEXT_PUBLIC_TIMEZONE
const SQL_TZ_OFFSET = resolveUtcOffset(process.env.NEXT_PUBLIC_TIMEZONE);

export async function getSessionEvents(sessionId: number): Promise<EventRow[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, event_time_utc, offset_s, duration_s, event_type
     FROM   events
     WHERE  session_id = ? AND archived_at_utc IS NULL
     ORDER  BY event_time_utc`,
    [sessionId]
  );
  return rows as EventRow[];
}

export async function getEventBreakdown(dateFrom?: string, dateTo?: string): Promise<EventBreakdownRow[]> {
  // night = sleep-night date using noon-to-noon boundary in the display timezone.
  // Formula: DATE( CONVERT_TZ(event_time_utc, '+00:00', <display_offset>) - INTERVAL 12 HOUR )
  // A 01:00 local event belongs to the previous calendar date ("last night").
  const nightExpr = `DATE(CONVERT_TZ(e.event_time_utc, '+00:00', '${SQL_TZ_OFFSET}') - INTERVAL 12 HOUR)`;
  let sql = `
    SELECT ${nightExpr} AS night,
           e.event_type,
           COUNT(*)      AS cnt
    FROM   events e
    JOIN   sleep_sessions s ON s.id = e.session_id
    WHERE  e.archived_at_utc IS NULL`;
  const params: string[] = [];
  if (dateFrom) { sql += ` AND ${nightExpr} >= ?`; params.push(dateFrom); }
  if (dateTo)   { sql += ` AND ${nightExpr} <= ?`; params.push(dateTo); }
  sql += ` GROUP BY night, e.event_type ORDER BY night, e.event_type`;
  const [rows] = await pool.execute<RowDataPacket[]>(sql, params);
  return (rows as RowDataPacket[]).map((r) => ({
    ...r,
    night: normDate(r.night),
  })) as EventBreakdownRow[];
}

/** All scored events for a given sleep night (night_date = YYYY-MM-DD), across all sessions of that night */
export async function getNightEvents(nightDate: string): Promise<EventRow[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT e.id, e.event_time_utc, e.offset_s, e.duration_s, e.event_type
     FROM   events e
     JOIN   sleep_sessions s ON s.id = e.session_id
     WHERE  s.night_date = ?
       AND  s.archived_at_utc IS NULL
       AND  e.archived_at_utc IS NULL
     ORDER  BY e.event_time_utc`,
    [nightDate]
  );
  return rows as EventRow[];
}
