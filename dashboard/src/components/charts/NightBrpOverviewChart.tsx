"use client";

import React, { memo, useMemo } from "react";
import {
  ResponsiveContainer, ComposedChart, Area, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import type { Brp1sRow } from "@/lib/queries/brp";
import { fmtHHMM } from "@/lib/utils";
import { useChartZoomPan } from "@/hooks/useChartZoomPan";
import { lttbWindow } from "@/lib/lttb";

const THRESHOLD = 1500;

interface Props {
  data: Brp1sRow[];
}

function NightBrpOverviewChart({ data }: Props) {
  const formatted = useMemo(
    () =>
      data.map((r) => ({
        t:         new Date(r.sample_time_utc).getTime(),
        flowMin:   r.flow_min,
        flowMax:   r.flow_max,
        flowMean:  r.flow_mean,
        pressMean: r.press_mean,
      })),
    [data]
  );

  const dataMin = formatted.length ? formatted[0]!.t  : 0;
  const dataMax = formatted.length ? formatted[formatted.length - 1]!.t : 1;

  const { domain, wrapperRef, wrapperProps, resetZoom, isZoomed } = useChartZoomPan(dataMin, dataMax);

  // Re-downsample whenever the zoom window changes
  const visible = useMemo(
    () => lttbWindow(formatted, domain[0], domain[1], THRESHOLD),
    [formatted, domain]
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
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={visible} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(222 20% 18%)" />
            <XAxis
              dataKey="t"
              scale="time"
              type="number"
              domain={domain}
              tick={{ fill: "hsl(210 20% 95%)", fontSize: 11 }}
              tickFormatter={(v: number) => fmtHHMM(v)}
              minTickGap={40}
            />
            <YAxis yAxisId="flow"  tick={{ fill: "hsl(210 20% 95%)", fontSize: 11 }} label={{ value: "L/s",    angle: -90, position: "insideLeft",  fill: "hsl(210 20% 95%)", fontSize: 10 }} />
            <YAxis yAxisId="press" orientation="right" tick={{ fill: "hsl(210 20% 95%)", fontSize: 11 }} label={{ value: "cmH₂O", angle: 90,  position: "insideRight", fill: "hsl(210 20% 95%)", fontSize: 10 }} />
            <Tooltip
              contentStyle={{ backgroundColor: "hsl(222 20% 11%)", border: "1px solid hsl(222 20% 18%)", borderRadius: 6 }}
              labelStyle={{ color: "hsl(210 20% 95%)", fontSize: 12 }}
              labelFormatter={(v: number) => fmtHHMM(v)}
              formatter={(v: number, name: string) => [typeof v === "number" ? v.toFixed(2) : v, name]}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: "hsl(210 20% 95%)" }} />
            <Area yAxisId="flow" type="monotone" dataKey="flowMax"   stroke="transparent"              fill="hsl(213 90% 55% / 0.15)" name="Flow envelope" connectNulls={false} isAnimationActive={false} />
            <Area yAxisId="flow" type="monotone" dataKey="flowMin"   stroke="transparent"              fill="hsl(222 20% 8%)"         name="_" legendType="none" connectNulls={false} isAnimationActive={false} />
            <Line yAxisId="flow"  type="monotone" dataKey="flowMean"  stroke="hsl(213 90% 55%)" strokeWidth={1} dot={false} name="Flow (mean)"      connectNulls={false} isAnimationActive={false} />
            <Line yAxisId="press" type="monotone" dataKey="pressMean" stroke="hsl(45 90% 55%)"  strokeWidth={1} dot={false} name="Pressure (mean)"  connectNulls={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Scroll to zoom · drag to pan · double-click to reset</p>
    </div>
  );
}

export default memo(NightBrpOverviewChart);
