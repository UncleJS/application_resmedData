"use client";

import React, { memo, useMemo } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ReferenceLine,
} from "recharts";
import type { DailySummaryRow } from "@/lib/queries/summary";
import { useChartZoomPan } from "@/hooks/useChartZoomPan";
import { lttbWindow } from "@/lib/lttb";

const THRESHOLD = 1500;

interface MetricDef {
  key: keyof DailySummaryRow;
  label: string;
  color: string;
  unit?: string;
}

export interface RefLine {
  value: number;
  label: string;
  color: string;
}

export interface ExtraLine {
  dataKey: string;
  label: string;
  color: string;
  strokeDasharray?: string;
}

interface Props {
  data: DailySummaryRow[];
  metrics: MetricDef[];
  height?: number;
  refLines?: RefLine[];
  yDomain?: [number, number];
  extraLines?: ExtraLine[];
}

function MetricLineChart({ data, metrics, height = 240, refLines, yDomain, extraLines }: Props) {
  const formatted = useMemo(() => data.map((d) => ({
    ...d,
    t: new Date(d.summary_date).getTime(),
  })), [data]);

  const dataMin = formatted.length ? formatted[0]!.t : 0;
  const dataMax = formatted.length ? formatted[formatted.length - 1]!.t : 1;

  const { domain, wrapperRef, wrapperProps, resetZoom, isZoomed } = useChartZoomPan(dataMin, dataMax);

  // Filter + downsample to the visible window so zoom actually changes rendered points
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
        <ResponsiveContainer width="100%" height={height}>
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
            <YAxis tick={{ fill: "hsl(215 15% 55%)", fontSize: 11 }} domain={yDomain ?? [0, "auto"]} />
            <Tooltip
              contentStyle={{ backgroundColor: "hsl(222 20% 11%)", border: "1px solid hsl(222 20% 18%)", borderRadius: 6 }}
              labelStyle={{ color: "hsl(210 20% 95%)", fontSize: 12 }}
              labelFormatter={(v: number) => new Date(v).toISOString().slice(0, 10)}
              formatter={(v: number, name: string) => [v != null ? v.toFixed(2) : "—", name]}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: "hsl(215 15% 55%)" }} />
            {refLines?.map((rl) => (
              <ReferenceLine
                key={rl.label}
                y={rl.value}
                stroke={rl.color}
                strokeWidth={1.5}
                strokeDasharray="6 3"
                label={{ value: rl.label, position: "insideTopRight", fill: rl.color, fontSize: 10 }}
              />
            ))}
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
            {extraLines?.map((el) => (
              <Line
                key={el.dataKey}
                type="stepAfter"
                dataKey={el.dataKey}
                name={el.label}
                stroke={el.color}
                strokeWidth={1.5}
                strokeDasharray={el.strokeDasharray ?? "6 3"}
                dot={false}
                connectNulls={false}
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
