import pool from "@/lib/db";
import type { RowDataPacket } from "mysql2";

export interface DailySummaryRow {
  summary_date: string;
  ahi: number | null;
  on_duration_min: number | null;
  leak_95: number | null;
  mask_press_95: number | null;
  resp_rate_50: number | null;
  tid_vol_50: number | null;
  oai: number | null;
  cai: number | null;
  hi: number | null;
  uai: number | null;
}

export interface NightSummaryRow {
  summary_date: string;
  ahi: number | null;
  oai: number | null;
  cai: number | null;
  hi: number | null;
  uai: number | null;
  on_duration_min: number | null;
  mask_press_50: number | null;
  mask_press_95: number | null;
  leak_50: number | null;
  leak_95: number | null;
  resp_rate_50: number | null;
  resp_rate_95: number | null;
  tid_vol_50: number | null;
  tid_vol_95: number | null;
  mask_events: number | null;
}

export interface StatCard {
  avgAhi: number | null;
  avgDurationMin: number | null;
  compliancePct: number | null;
  avgLeak95: number | null;
}

/** Coerce a mysql2 DATE value (may be a JS Date object) to a YYYY-MM-DD string */
function normDate(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function normRows(rows: RowDataPacket[]): DailySummaryRow[] {
  return rows.map((r) => ({ ...r, summary_date: normDate(r.summary_date) })) as DailySummaryRow[];
}

/** 90-day AHI trend for the summary chart */
export async function getAhiTrend(days = 90): Promise<DailySummaryRow[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT summary_date, ahi, on_duration_min, leak_95,
            mask_press_95, resp_rate_50, tid_vol_50,
            oai, cai, hi, uai
     FROM   daily_summary
     WHERE  archived_at_utc IS NULL
       AND  summary_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     ORDER  BY summary_date`,
    [days]
  );
  return normRows(rows as RowDataPacket[]);
}

/** 30-day stat cards */
export async function getStatCards(): Promise<StatCard> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT
       ROUND(AVG(ahi), 2)            AS avgAhi,
       ROUND(AVG(on_duration_min), 1) AS avgDurationMin,
       ROUND(
         100.0 * SUM(CASE WHEN on_duration_min >= 240 THEN 1 ELSE 0 END)
               / COUNT(*), 1
       )                              AS compliancePct,
       ROUND(AVG(leak_95), 3)        AS avgLeak95
     FROM daily_summary
     WHERE archived_at_utc IS NULL
       AND summary_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`
  );
  const r = (rows as RowDataPacket[])[0];
  return {
    avgAhi: r?.avgAhi ?? null,
    avgDurationMin: r?.avgDurationMin ?? null,
    compliancePct: r?.compliancePct ?? null,
    avgLeak95: r?.avgLeak95 ?? null,
  };
}

/** Full summary row for a single night (by summary_date = night_date) */
export async function getNightSummary(date: string): Promise<NightSummaryRow | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT summary_date,
            ahi, oai, cai, hi, uai,
            on_duration_min,
            mask_press_50, mask_press_95,
            leak_50, leak_95,
            resp_rate_50, resp_rate_95,
            tid_vol_50, tid_vol_95,
            mask_events
     FROM   daily_summary
     WHERE  summary_date = ? AND archived_at_utc IS NULL
     LIMIT  1`,
    [date]
  );
  const r = (rows as RowDataPacket[])[0];
  if (!r) return null;
  return { ...r, summary_date: normDate(r.summary_date) } as NightSummaryRow;
}

/** Full range for trends page with date filter */
export async function getTrends(dateFrom?: string, dateTo?: string): Promise<DailySummaryRow[]> {
  let sql = `SELECT summary_date, ahi, on_duration_min, leak_95,
                    mask_press_95, resp_rate_50, tid_vol_50,
                    oai, cai, hi, uai
             FROM   daily_summary
             WHERE  archived_at_utc IS NULL`;
  const params: string[] = [];
  if (dateFrom) { sql += " AND summary_date >= ?"; params.push(dateFrom); }
  if (dateTo)   { sql += " AND summary_date <= ?"; params.push(dateTo); }
  sql += " ORDER BY summary_date";
  const [rows] = await pool.execute<RowDataPacket[]>(sql, params);
  return normRows(rows as RowDataPacket[]);
}
