import pool from "@/lib/db";
import type { RowDataPacket } from "mysql2";

export interface PldRow {
  sample_time_utc: string;
  offset_s: number;
  mask_press_cmh2o: number | null;
  press_cmh2o: number | null;
  leak_l_s: number | null;
  resp_rate_bpm: number | null;
  snore: number | null;
  flow_lim: number | null;
}

export async function getSessionPld(sessionId: number): Promise<PldRow[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT sample_time_utc, offset_s,
            mask_press_cmh2o, press_cmh2o,
            leak_l_s, resp_rate_bpm, snore, flow_lim
     FROM   pld_samples
     WHERE  session_id = ? AND archived_at_utc IS NULL
     ORDER  BY sample_time_utc`,
    [sessionId]
  );
  return rows as PldRow[];
}

/** All PLD samples for a given sleep night, stitched across all sessions, ordered by absolute time */
export async function getNightPld(nightDate: string): Promise<PldRow[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT p.sample_time_utc, p.offset_s,
            p.mask_press_cmh2o, p.press_cmh2o,
            p.leak_l_s, p.resp_rate_bpm, p.snore, p.flow_lim
     FROM   pld_samples p
     JOIN   sleep_sessions s ON s.id = p.session_id
     WHERE  s.night_date = ?
       AND  s.archived_at_utc IS NULL
       AND  p.archived_at_utc IS NULL
     ORDER  BY p.sample_time_utc`,
    [nightDate]
  );
  return rows as PldRow[];
}
