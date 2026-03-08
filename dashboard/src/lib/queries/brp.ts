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
