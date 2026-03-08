"use client";

import React, { memo } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from "recharts";
import type { EventBreakdownRow } from "@/lib/queries/events";
import { useChartZoomPan } from "@/hooks/useChartZoomPan";

interface Props { data: EventBreakdownRow[] }

const EVENT_COLORS: Record<string, string> = {
  "Obstructive Apnea": "hsl(0 70% 55%)",
  "Central Apnea":     "hsl(213 90% 55%)",
  "Hypopnea":          "hsl(45 90% 55%)",
  "Unclassified Apnea":"hsl(280 70% 60%)",
  "RERA":              "hsl(160 60% 50%)",
};

function EventBreakdownChart({ data }: Props) {
  const nights = [...new Set(data.map((r) => r.night))].sort();
  const types  = [...new Set(data.map((r) => r.event_type))];

  const pivoted = nights.map((night, i) => {
    const row: Record<string, string | number> = {
      night: String(night).slice(5),
      t: i,
    };
    for (const t of types) {
      const found = data.find((r) => r.night === night && r.event_type === t);
      row[t] = found?.cnt ?? 0;
    }
    return row;
  });

  const dataMin = 0;
  const dataMax = Math.max(0, pivoted.length - 1);

  const { domain, wrapperRef, wrapperProps, resetZoom, isZoomed } = useChartZoomPan(dataMin, dataMax);

  const [dLeft, dRight] = domain;
  const visible = pivoted.filter((r) => (r.t as number) >= dLeft - 0.5 && (r.t as number) <= dRight + 0.5);

  return (
    <div className="relative">
      {isZoomed && (
        <button
          onClick={resetZoom}
          className="absolute top-0 right-0 z-10 rounded border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent transition-colors"
        >
          Reset zoom
        </button>
      )}
      <div ref={wrapperRef} {...wrapperProps} className="select-none">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={visible} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(222 20% 18%)" />
            <XAxis dataKey="night" tick={{ fill: "hsl(210 20% 95%)", fontSize: 11 }} minTickGap={20} />
            <YAxis tick={{ fill: "hsl(210 20% 95%)", fontSize: 11 }} />
            <Tooltip
              contentStyle={{ backgroundColor: "hsl(222 20% 11%)", border: "1px solid hsl(222 20% 18%)", borderRadius: 6 }}
              labelStyle={{ color: "hsl(210 20% 95%)", fontSize: 12 }}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: "hsl(210 20% 95%)" }} />
            {types.map((t) => (
              <Bar key={t} dataKey={t} stackId="a" fill={EVENT_COLORS[t] ?? "hsl(210 20% 95%)"} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Scroll to zoom · drag to pan · double-click to reset</p>
    </div>
  );
}

export default memo(EventBreakdownChart);
