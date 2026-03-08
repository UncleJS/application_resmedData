import pool from "@/lib/db";
import type { RowDataPacket } from "mysql2";

export interface SessionRow {
  id: number;
  session_start_utc: string;
  session_end_utc: string | null;
  /** Duration in minutes derived from BRP max offset_s */
  duration_min: number | null;
  day_dir: string;
  night_date: string;
  /** Night-level AHI from daily_summary (same value for all sessions on same night) */
  night_ahi: number | null;
  /** Night-level usage from daily_summary */
  night_on_duration_min: number | null;
  /** Night-level leak p95 from daily_summary (L/s) */
  night_leak_95: number | null;
  /** Per-session AHI derived from COUNT(events) / (MAX(brp_samples_1s.offset_s) / 3600) */
  session_ahi: number | null;
  /** Per-session leak p95 from PLD samples (L/s), via window function */
  session_leak_95: number | null;
  /** BRP max offset_s — true session duration in seconds */
  brp_duration_s: number | null;
}

export interface SessionDetail {
  id: number;
  session_start_utc: string;
  session_end_utc: string | null;
  day_dir: string;
  night_date: string;
}

function normDateField(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function normNullable(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function mapRow(r: RowDataPacket): SessionRow {
  const start = normDateField(r.session_start_utc);
  const end   = normNullable(r.session_end_utc);
  const brpS  = r.brp_duration_s != null ? Number(r.brp_duration_s) : null;
  return {
    id:                    r.id,
    session_start_utc:     start,
    session_end_utc:       end,
    duration_min:          brpS != null ? brpS / 60 : null,
    day_dir:               normDateField(r.day_dir),
    night_date:            normDateField(r.night_date),
    night_ahi:             r.night_ahi   ?? null,
    night_on_duration_min: r.night_on_duration_min ?? null,
    night_leak_95:         r.night_leak_95 ?? null,
    session_ahi:           r.session_ahi != null ? Number(r.session_ahi) : null,
    session_leak_95:       r.session_leak_95 != null ? Number(r.session_leak_95) : null,
    brp_duration_s:        brpS,
  };
}

/**
 * Per-session AHI and leak p95 — now read directly from pre-computed columns
 * on sleep_sessions (session_duration_s, session_leak_95) populated at import
 * time. The events sub-query is kept because it is small (141 rows) and still
 * needed to compute session_ahi.
 */
const SESSION_STATS_JOIN = `
  LEFT JOIN (
    SELECT e.session_id,
           COUNT(e.id) AS event_count
    FROM events e
    WHERE e.archived_at_utc IS NULL
    GROUP BY e.session_id
  ) ev ON ev.session_id = s.id
`;

const SESSION_STAT_COLS = `
  s.session_duration_s                        AS brp_duration_s,
  CASE
    WHEN s.session_duration_s > 0
    THEN ev.event_count / (s.session_duration_s / 3600.0)
    ELSE NULL
  END AS session_ahi,
  s.session_leak_95
`;

export async function getSessions(page = 1, perPage = 30): Promise<{ rows: SessionRow[]; total: number }> {
  const offset = (page - 1) * perPage;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT s.id, s.session_start_utc, s.session_end_utc, s.day_dir, s.night_date,
            d.ahi             AS night_ahi,
            d.on_duration_min AS night_on_duration_min,
            d.leak_95         AS night_leak_95,
            ${SESSION_STAT_COLS}
     FROM   sleep_sessions s
     LEFT JOIN daily_summary d ON d.summary_date = s.night_date AND d.archived_at_utc IS NULL
     ${SESSION_STATS_JOIN}
     WHERE  s.archived_at_utc IS NULL
     ORDER  BY s.session_start_utc DESC
     LIMIT  ? OFFSET ?`,
    [perPage, offset]
  );
  const [countRows] = await pool.execute<RowDataPacket[]>(
    "SELECT COUNT(*) AS total FROM sleep_sessions WHERE archived_at_utc IS NULL"
  );
  return {
    rows: (rows as RowDataPacket[]).map(mapRow),
    total: (countRows as RowDataPacket[])[0]?.total ?? 0,
  };
}

export async function getSession(id: number): Promise<SessionDetail | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    "SELECT id, session_start_utc, session_end_utc, day_dir, night_date FROM sleep_sessions WHERE id = ? AND archived_at_utc IS NULL LIMIT 1",
    [id]
  );
  const r = (rows as RowDataPacket[])[0];
  if (!r) return null;
  return {
    id:                r.id,
    session_start_utc: normDateField(r.session_start_utc),
    session_end_utc:   normNullable(r.session_end_utc),
    day_dir:           normDateField(r.day_dir),
    night_date:        normDateField(r.night_date),
  } as SessionDetail;
}

/** All sessions belonging to a given sleep night (night_date = YYYY-MM-DD) */
export async function getNightSessions(nightDate: string): Promise<SessionRow[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT s.id, s.session_start_utc, s.session_end_utc, s.day_dir, s.night_date,
            d.ahi             AS night_ahi,
            d.on_duration_min AS night_on_duration_min,
            d.leak_95         AS night_leak_95,
            ${SESSION_STAT_COLS}
     FROM   sleep_sessions s
     LEFT JOIN daily_summary d ON d.summary_date = s.night_date AND d.archived_at_utc IS NULL
     ${SESSION_STATS_JOIN}
     WHERE  s.night_date = ? AND s.archived_at_utc IS NULL
     ORDER  BY s.session_start_utc`,
    [nightDate]
  );
  return (rows as RowDataPacket[]).map(mapRow);
}
