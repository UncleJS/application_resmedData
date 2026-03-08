"use client";

import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
} from "recharts";
import type { DailySummaryRow } from "@/lib/queries/summary";
import { ahiColor } from "@/lib/utils";

interface Props { data: DailySummaryRow[] }

export default function AhiTrendChart({ data }: Props) {
  const formatted = data.map((d) => ({
    date: d.summary_date,
    ahi: d.ahi ?? null,
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={formatted} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(222 20% 18%)" />
        <XAxis
          dataKey="date"
          tick={{ fill: "hsl(210 20% 95%)", fontSize: 11 }}
          tickFormatter={(v) => String(v).slice(0, 10).slice(5)}
          minTickGap={30}
        />
        <YAxis tick={{ fill: "hsl(215 15% 55%)", fontSize: 11 }} domain={[0, "auto"]} />
        <Tooltip
          contentStyle={{ backgroundColor: "hsl(222 20% 11%)", border: "1px solid hsl(222 20% 18%)", borderRadius: 6 }}
          labelStyle={{ color: "hsl(210 20% 95%)", fontSize: 12 }}
          itemStyle={{ color: "hsl(213 90% 65%)" }}
          formatter={(v: number) => [v != null ? v.toFixed(2) : "—", "ahi"]}
        />
        <ReferenceLine y={5}  stroke="hsl(142 70% 45%)" strokeDasharray="4 4" label={{ value: "5", fill: "hsl(142 70% 45%)", fontSize: 10 }} />
        <ReferenceLine y={15} stroke="hsl(45 90% 55%)"  strokeDasharray="4 4" label={{ value: "15", fill: "hsl(45 90% 55%)", fontSize: 10 }} />
        <Line
          type="monotone"
          dataKey="ahi"
          stroke="hsl(213 90% 55%)"
          strokeWidth={1.5}
          dot={false}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
