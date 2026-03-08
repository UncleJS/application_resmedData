"use client";

import {
  ResponsiveContainer, ComposedChart, Area, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import type { Brp1sRow } from "@/lib/queries/brp";
import { fmtHHMM } from "@/lib/utils";

interface Props {
  data: Brp1sRow[];
  sessionStart: string;  // UTC ISO string, e.g. "2026-01-01T19:42:52.000Z"
}

function toEpochMs(sessionStartIso: string, offsetS: number): number {
  return new Date(sessionStartIso).getTime() + offsetS * 1000;
}

export default function BrpOverviewChart({ data, sessionStart }: Props) {
  const formatted = data.map((r) => ({
    t: r.offset_s,
    flowMin:   r.flow_min,
    flowMax:   r.flow_max,
    flowMean:  r.flow_mean,
    pressMean: r.press_mean,
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={formatted} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(222 20% 18%)" />
        <XAxis
          dataKey="t"
          tick={{ fill: "hsl(210 20% 95%)", fontSize: 11 }}
          tickFormatter={(v: number) => fmtHHMM(toEpochMs(sessionStart, v))}
          minTickGap={40}
        />
        <YAxis yAxisId="flow"  tick={{ fill: "hsl(210 20% 95%)", fontSize: 11 }} label={{ value: "L/s",    angle: -90, position: "insideLeft",  fill: "hsl(210 20% 95%)", fontSize: 10 }} />
        <YAxis yAxisId="press" orientation="right" tick={{ fill: "hsl(210 20% 95%)", fontSize: 11 }} label={{ value: "cmH₂O", angle: 90,  position: "insideRight", fill: "hsl(210 20% 95%)", fontSize: 10 }} />
        <Tooltip
          contentStyle={{ backgroundColor: "hsl(222 20% 11%)", border: "1px solid hsl(222 20% 18%)", borderRadius: 6 }}
          labelStyle={{ color: "hsl(210 20% 95%)", fontSize: 12 }}
          labelFormatter={(v: number) => fmtHHMM(toEpochMs(sessionStart, v))}
          formatter={(v: number, name: string) => [
            typeof v === "number" ? v.toFixed(2) : v,
            name,
          ]}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: "hsl(210 20% 95%)" }} />
        {/* Flow envelope */}
        <Area yAxisId="flow" type="monotone" dataKey="flowMax" stroke="transparent" fill="hsl(213 90% 55% / 0.15)" name="Flow envelope" />
        <Area yAxisId="flow" type="monotone" dataKey="flowMin" stroke="transparent" fill="hsl(222 20% 8%)"         name="_" legendType="none" />
        <Line yAxisId="flow"  type="monotone" dataKey="flowMean"  stroke="hsl(213 90% 55%)" strokeWidth={1} dot={false} name="Flow (mean)" />
        <Line yAxisId="press" type="monotone" dataKey="pressMean" stroke="hsl(45 90% 55%)"  strokeWidth={1} dot={false} name="Pressure (mean)" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

