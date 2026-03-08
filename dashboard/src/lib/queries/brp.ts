import pool from "@/lib/db";
import type { RowDataPacket } from "mysql2";

export interface Brp1sRow {
  sample_time_utc: string;
  offset_s: number;
  flow_min: number | null;
  flow_max: number | null;
  flow_mean: number | null;
  press_min: number | null;
  press_max: number | null;
  press_mean: number | null;
}

export interface BrpFullRow {
  offset_ms: number;
  flow_l_s: number | null;
  pressure_cmh2o: number | null;
}

/** 1-second overview from pre-aggregated table */
export async function getSessionBrp1s(sessionId: number): Promise<Brp1sRow[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT sample_time_utc, offset_s,
            flow_min, flow_max, flow_mean,
            press_min, press_max, press_mean
     FROM   brp_samples_1s
     WHERE  session_id = ? AND archived_at_utc IS NULL
     ORDER  BY sample_time_utc`,
    [sessionId]
  );
  return rows as Brp1sRow[];
}

/** All 1s BRP buckets for a given sleep night, stitched across all sessions, ordered by absolute time */
export async function getNightBrp1s(nightDate: string): Promise<Brp1sRow[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT b.sample_time_utc, b.offset_s,
            b.flow_min, b.flow_max, b.flow_mean,
            b.press_min, b.press_max, b.press_mean
     FROM   brp_samples_1s b
     JOIN   sleep_sessions s ON s.id = b.session_id
     WHERE  s.night_date = ?
       AND  s.archived_at_utc IS NULL
       AND  b.archived_at_utc IS NULL
     ORDER  BY b.sample_time_utc`,
    [nightDate]
  );
  return rows as Brp1sRow[];
}

/** Full-resolution BRP downsampled server-side to configurable ms buckets (for canvas viewer) */
export async function getSessionBrpFull(
  sessionId: number,
  bucketMs: number = 200
): Promise<BrpFullRow[]> {
  // Clamp bucket to safe range (40ms–5000ms)
  const b = Math.max(40, Math.min(5000, bucketMs));
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT FLOOR(offset_ms / ?) * ?              AS offset_ms,
            ROUND(AVG(flow_l_s),       4)          AS flow_l_s,
            ROUND(AVG(pressure_cmh2o), 4)          AS pressure_cmh2o
     FROM   brp_samples
     WHERE  session_id = ? AND archived_at_utc IS NULL
     GROUP  BY FLOOR(offset_ms / ?)
     ORDER  BY offset_ms`,
    [b, b, sessionId, b]
  );
  return rows as BrpFullRow[];
}

export interface NightBrpRow {
  /** Absolute epoch-ms of the bucket (derived from sample_time_utc) */
  epoch_ms: number;
  flow_l_s: number | null;
  pressure_cmh2o: number | null;
}

/**
 * Night-level full-resolution BRP stitched across all sessions.
 * Returns data bucketed by wall-clock time (epoch-ms) so gaps between
 * sessions appear naturally as missing data in the canvas viewer.
 */
export async function getNightBrpFull(
  nightDate: string,
  bucketMs: number = 200
): Promise<NightBrpRow[]> {
  const b = Math.max(40, Math.min(5000, bucketMs));
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT FLOOR(UNIX_TIMESTAMP(CONVERT_TZ(br.sample_time_utc, '+00:00', @@session.time_zone)) * 1000 / ?) * ? AS epoch_ms,
            ROUND(AVG(br.flow_l_s),        4)                                                                    AS flow_l_s,
            ROUND(AVG(br.pressure_cmh2o),  4)                                                                    AS pressure_cmh2o
     FROM   brp_samples br
     JOIN   sleep_sessions s ON s.id = br.session_id
     WHERE  s.night_date = ?
       AND  s.archived_at_utc IS NULL
       AND  br.archived_at_utc IS NULL
     GROUP  BY FLOOR(UNIX_TIMESTAMP(CONVERT_TZ(br.sample_time_utc, '+00:00', @@session.time_zone)) * 1000 / ?)
     ORDER  BY epoch_ms`,
    [b, b, nightDate, b]
  );
  return (rows as RowDataPacket[]).map((r) => ({
    epoch_ms:       Number(r.epoch_ms),
    flow_l_s:       r.flow_l_s       != null ? Number(r.flow_l_s)       : null,
    pressure_cmh2o: r.pressure_cmh2o != null ? Number(r.pressure_cmh2o) : null,
  }));
}
