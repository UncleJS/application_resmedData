"use client";

import {
  ResponsiveContainer, ComposedChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine, Legend,
} from "recharts";
import type { PldRow } from "@/lib/queries/pld";
import type { EventRow } from "@/lib/queries/events";
import { fmtHHMM } from "@/lib/utils";

interface Props {
  pld: PldRow[];
  events: EventRow[];
  sessionStart: string;  // UTC ISO string, e.g. "2026-01-01T19:42:52.000Z"
}

const EVENT_COLORS: Record<string, string> = {
  "Obstructive Apnea": "hsl(0 70% 60%)",
  "Central Apnea":     "hsl(213 90% 60%)",
  "Hypopnea":          "hsl(45 90% 60%)",
  "Unclassified Apnea":"hsl(280 70% 65%)",
  "RERA":              "hsl(160 60% 55%)",
};

function toEpochMs(sessionStartIso: string, offsetS: number): number {
  return new Date(sessionStartIso).getTime() + offsetS * 1000;
}

export default function SessionDetailChart({ pld, events, sessionStart }: Props) {
  const data = pld.map((r) => ({
    t:     r.offset_s,
    press: r.mask_press_cmh2o,
    leak:  r.leak_l_s != null ? r.leak_l_s * 60 : null,  // L/s → L/min
    snore: r.snore,
    flowLim: r.flow_lim,
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(222 20% 18%)" />
        <XAxis
          dataKey="t"
          tick={{ fill: "hsl(210 20% 95%)", fontSize: 11 }}
          tickFormatter={(v: number) => fmtHHMM(toEpochMs(sessionStart, v))}
          minTickGap={40}
        />
        <YAxis tick={{ fill: "hsl(210 20% 95%)", fontSize: 11 }} />
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
        <Line type="monotone" dataKey="press"   stroke="hsl(45 90% 55%)"  strokeWidth={1.5} dot={false} name="Mask press (cmH₂O)" />
        <Line type="monotone" dataKey="leak"    stroke="hsl(0 70% 55%)"   strokeWidth={1}   dot={false} name="Leak (L/min)" />
        <Line type="monotone" dataKey="snore"   stroke="hsl(280 70% 60%)" strokeWidth={1}   dot={false} name="Snore index" />
        <Line type="monotone" dataKey="flowLim" stroke="hsl(160 60% 50%)" strokeWidth={1}   dot={false} name="Flow limitation" />
        {events.map((ev) => (
          <ReferenceLine
            key={ev.id}
            x={ev.offset_s}
            stroke={EVENT_COLORS[ev.event_type] ?? "hsl(210 20% 95%)"}
            strokeWidth={1.5}
            strokeDasharray="4 2"
            label={{ value: ev.event_type.split(" ")[0], fill: EVENT_COLORS[ev.event_type] ?? "hsl(210 20% 95%)", fontSize: 9, position: "top" }}
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

