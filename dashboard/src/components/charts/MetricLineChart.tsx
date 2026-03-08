"use client";

import React, { memo } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from "recharts";
import type { DailySummaryRow } from "@/lib/queries/summary";
import { useChartZoomPan } from "@/hooks/useChartZoomPan";

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

function MetricLineChart({ data, metrics, height = 240 }: Props) {
  const formatted = data.map((d) => ({
    ...d,
    t: new Date(d.summary_date).getTime(),
  }));

  const dataMin = formatted.length ? formatted[0]!.t : 0;
  const dataMax = formatted.length ? formatted[formatted.length - 1]!.t : 1;

  const { domain, wrapperRef, wrapperProps, resetZoom, isZoomed } = useChartZoomPan(dataMin, dataMax);

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
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={formatted} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(222 20% 18%)" />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={domain}
              tick={{ fill: "hsl(210 20% 95%)", fontSize: 11 }}
              tickFormatter={(v: number) => new Date(v).toISOString().slice(5, 10)}
              minTickGap={30}
            />
            <YAxis tick={{ fill: "hsl(215 15% 55%)", fontSize: 11 }} />
            <Tooltip
              contentStyle={{ backgroundColor: "hsl(222 20% 11%)", border: "1px solid hsl(222 20% 18%)", borderRadius: 6 }}
              labelStyle={{ color: "hsl(210 20% 95%)", fontSize: 12 }}
              labelFormatter={(v: number) => new Date(v).toISOString().slice(0, 10)}
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
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Scroll to zoom · drag to pan · double-click to reset</p>
    </div>
  );
}

export default memo(MetricLineChart);
