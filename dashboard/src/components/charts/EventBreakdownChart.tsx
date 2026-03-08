"use client";

import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from "recharts";
import type { EventBreakdownRow } from "@/lib/queries/events";

interface Props { data: EventBreakdownRow[] }

const EVENT_COLORS: Record<string, string> = {
  "Obstructive Apnea": "hsl(0 70% 55%)",
  "Central Apnea":     "hsl(213 90% 55%)",
  "Hypopnea":          "hsl(45 90% 55%)",
  "Unclassified Apnea":"hsl(280 70% 60%)",
  "RERA":              "hsl(160 60% 50%)",
};

export default function EventBreakdownChart({ data }: Props) {
  // Pivot: night → { [eventType]: count }
  const nights = [...new Set(data.map((r) => r.night))].sort();
  const types  = [...new Set(data.map((r) => r.event_type))];

  const pivoted = nights.map((night) => {
    const row: Record<string, string | number> = { night: String(night).slice(5) };
    for (const t of types) {
      const found = data.find((r) => r.night === night && r.event_type === t);
      row[t] = found?.cnt ?? 0;
    }
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={pivoted} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(222 20% 18%)" />
        <XAxis dataKey="night" tick={{ fill: "hsl(210 20% 95%)", fontSize: 11 }} minTickGap={20} />
        <YAxis tick={{ fill: "hsl(210 20% 95%)", fontSize: 11 }} />
        <Tooltip
          contentStyle={{ backgroundColor: "hsl(222 20% 11%)", border: "1px solid hsl(222 20% 18%)", borderRadius: 6 }}
          labelStyle={{ color: "hsl(210 20% 95%)", fontSize: 12 }}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: "hsl(210 20% 95%)" }} />
        {types.map((t) => (
          <Bar key={t} dataKey={t} stackId="a" fill={EVENT_COLORS[t] ?? "hsl(210 20% 95%)"} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
