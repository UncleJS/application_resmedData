"use client";

import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from "recharts";
import type { DailySummaryRow } from "@/lib/queries/summary";

interface MetricDef {
  key: keyof DailySummaryRow;
  label: string;
  color: string;
  unit?: string;
}

interface Props {
  data: DailySummaryRow[];
  metrics: MetricDef[];
  height?: number;
}

export default function MetricLineChart({ data, metrics, height = 240 }: Props) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(222 20% 18%)" />
        <XAxis
          dataKey="summary_date"
          tick={{ fill: "hsl(210 20% 95%)", fontSize: 11 }}
          tickFormatter={(v) => String(v).slice(0, 10).slice(5)}
          minTickGap={30}
        />
        <YAxis tick={{ fill: "hsl(215 15% 55%)", fontSize: 11 }} />
        <Tooltip
          contentStyle={{ backgroundColor: "hsl(222 20% 11%)", border: "1px solid hsl(222 20% 18%)", borderRadius: 6 }}
          labelStyle={{ color: "hsl(210 20% 95%)", fontSize: 12 }}
          formatter={(v: number, name: string) => [v != null ? v.toFixed(2) : "—", name]}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: "hsl(215 15% 55%)" }} />
        {metrics.map((m) => (
          <Line
            key={String(m.key)}
            type="monotone"
            dataKey={m.key as string}
            name={m.label}
            stroke={m.color}
            strokeWidth={1.5}
            dot={false}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
