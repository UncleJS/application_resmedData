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
