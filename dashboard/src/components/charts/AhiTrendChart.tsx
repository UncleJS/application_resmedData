"use client";

import React, { memo, useMemo } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
} from "recharts";
import type { DailySummaryRow } from "@/lib/queries/summary";
import { useChartZoomPan } from "@/hooks/useChartZoomPan";

interface Props { data: DailySummaryRow[]; avg?: number | null }

function AhiTrendChart({ data, avg }: Props) {
  const formatted = useMemo(() => data.map((d) => ({
    t:   new Date(d.summary_date).getTime(),
    ahi: d.ahi ?? null,
  })), [data]);

  const dataMin = formatted.length ? formatted[0]!.t  : 0;
  const dataMax = formatted.length ? formatted[formatted.length - 1]!.t : 1;

  const { domain, wrapperRef, wrapperProps, resetZoom, isZoomed } = useChartZoomPan(dataMin, dataMax);

  // Filter to visible window so zoom actually changes what's rendered
  const visible = useMemo(
    () => formatted.filter((d) => d.t >= domain[0] && d.t <= domain[1]),
    [formatted, domain]
  );

  // Max AHI in the visible window — used to decide whether reference lines are in range
  const visibleMax = useMemo(
    () => visible.reduce((m, d) => (d.ahi != null && d.ahi > m ? d.ahi : m), 0),
    [visible]
  );

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
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={visible} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
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
            <YAxis tick={{ fill: "hsl(215 15% 55%)", fontSize: 11 }} domain={[0, "auto"]} />
            <Tooltip
              contentStyle={{ backgroundColor: "hsl(222 20% 11%)", border: "1px solid hsl(222 20% 18%)", borderRadius: 6 }}
              labelStyle={{ color: "hsl(210 20% 95%)", fontSize: 12 }}
              itemStyle={{ color: "hsl(213 90% 65%)" }}
              labelFormatter={(v: number) => new Date(v).toISOString().slice(0, 10)}
              formatter={(v: number) => [v != null ? v.toFixed(2) : "—", "AHI"]}
            />
            {/* Only render reference lines when the Y axis would include them */}
            {visibleMax >= 4 && (
              <ReferenceLine y={5}  stroke="hsl(142 70% 45%)" strokeDasharray="4 4"
                label={{ value: "Normal (5)", position: "insideTopRight", fill: "hsl(142 70% 45%)", fontSize: 10 }} />
            )}
            {visibleMax >= 13 && (
              <ReferenceLine y={15} stroke="hsl(45 90% 55%)"  strokeDasharray="4 4"
                label={{ value: "Moderate (15)", position: "insideTopRight", fill: "hsl(45 90% 55%)",  fontSize: 10 }} />
            )}
            {/* Average line — always visible, solid white */}
            {avg != null && (
              <ReferenceLine y={avg} stroke="hsl(0 0% 90%)" strokeWidth={1.5}
                label={{ value: `Avg ${avg.toFixed(1)}`, position: "insideTopRight", fill: "hsl(0 0% 90%)", fontSize: 10 }} />
            )}
            <Line type="monotone" dataKey="ahi" stroke="hsl(213 90% 55%)" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Scroll to zoom · drag to pan · double-click to reset</p>
    </div>
  );
}

export default memo(AhiTrendChart);
