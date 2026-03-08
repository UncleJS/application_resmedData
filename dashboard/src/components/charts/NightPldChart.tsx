"use client";

import React, { memo, useMemo } from "react";
import {
  ResponsiveContainer, ComposedChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine, Legend, Label,
} from "recharts";
import type { PldRow } from "@/lib/queries/pld";
import type { EventRow } from "@/lib/queries/events";
import { fmtHHMM } from "@/lib/utils";
import { useChartZoomPan } from "@/hooks/useChartZoomPan";
import { lttbWindow } from "@/lib/lttb";

const THRESHOLD = 1500;

interface Props {
  pld: PldRow[];
  events: EventRow[];
}

const EVENT_COLORS: Record<string, string> = {
  "Obstructive Apnea":  "hsl(0 70% 60%)",
  "Central Apnea":      "hsl(213 90% 60%)",
  "Hypopnea":           "hsl(45 90% 60%)",
  "Unclassified Apnea": "hsl(280 70% 65%)",
  "RERA":               "hsl(160 60% 55%)",
};

/** Dark text on light/yellow backgrounds, white on all others */
const EVENT_TEXT_COLORS: Record<string, string> = {
  "Obstructive Apnea":  "#fff",
  "Central Apnea":      "#fff",
  "Hypopnea":           "#111",
  "Unclassified Apnea": "#fff",
  "RERA":               "#111",
};

const EVENT_ABBR: Record<string, string> = {
  "Obstructive Apnea":  "OAI",
  "Central Apnea":      "CAI",
  "Hypopnea":           "HI",
  "Unclassified Apnea": "UAI",
  "RERA":               "RERA",
};

/** SVG flag label rendered at the top of a ReferenceLine */
function EventFlagLabel(props: {
  viewBox?: { x?: number; y?: number; height?: number };
  label: string;
  color: string;
  textColor: string;
}) {
  const { viewBox, label, color, textColor } = props;
  const x = viewBox?.x ?? 0;
  const y = viewBox?.y ?? 0;
  const w = label.length * 5.5 + 6;
  const h = 14;
  return (
    <g>
      <line x1={x} y1={y} x2={x} y2={y + 4} stroke={color} strokeWidth={1.5} />
      <rect x={x + 1} y={y} width={w} height={h} rx={2} fill={color} fillOpacity={0.9} />
      <text
        x={x + 1 + w / 2}
        y={y + h / 2 + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={textColor}
        fontSize={9}
        fontWeight={600}
        fontFamily="monospace"
      >
        {label}
      </text>
    </g>
  );
}

function NightPldChart({ pld, events }: Props) {
  const rawData = useMemo(
    () =>
      pld.map((r) => ({
        t:       new Date(r.sample_time_utc).getTime(),
        press:   r.mask_press_cmh2o,
        leak:    r.leak_l_s != null ? r.leak_l_s * 60 : null,
        snore:   r.snore,
        flowLim: r.flow_lim,
        _event:  undefined as string | undefined,
      })),
    [pld]
  );

  // Stamp nearest data point (within 5 s) with event abbreviation for tooltip
  const data = useMemo(() => {
    if (!events.length) return rawData;
    const pts = rawData.map((p) => ({ ...p }));
    for (const ev of events) {
      const evT = new Date(ev.event_time_utc).getTime();
      let best = -1;
      let bestDist = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const d = Math.abs(pts[i]!.t - evT);
        if (d < bestDist) { bestDist = d; best = i; }
      }
      if (best >= 0 && bestDist <= 5000) {
        const abbr = EVENT_ABBR[ev.event_type] ?? ev.event_type;
        pts[best]!._event = pts[best]!._event
          ? `${pts[best]!._event} · ${abbr}`
          : abbr;
      }
    }
    return pts;
  }, [rawData, events]);

  const dataMin = data.length ? data[0]!.t  : 0;
  const dataMax = data.length ? data[data.length - 1]!.t : 1;

  const { domain, wrapperRef, wrapperProps, resetZoom, isZoomed } = useChartZoomPan(dataMin, dataMax);

  // Re-downsample whenever the zoom window changes
  const visible = useMemo(
    () => lttbWindow(data, domain[0], domain[1], THRESHOLD),
    [data, domain]
  );

  // Filter events to visible window for cheaper ReferenceLine rendering
  const visibleEvents = useMemo(
    () => events.filter((ev) => {
      const t = new Date(ev.event_time_utc).getTime();
      return t >= domain[0] && t <= domain[1];
    }),
    [events, domain]
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
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={visible} margin={{ top: 20, right: 8, left: -16, bottom: 0 }}>
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
            <YAxis tick={{ fill: "hsl(210 20% 95%)", fontSize: 11 }} />
            <Tooltip
              contentStyle={{ backgroundColor: "hsl(222 20% 11%)", border: "1px solid hsl(222 20% 18%)", borderRadius: 6 }}
              labelStyle={{ color: "hsl(210 20% 95%)", fontSize: 12 }}
              labelFormatter={(v: number) => fmtHHMM(v)}
              content={(props) => {
                if (!props.active || !props.payload?.length) return null;
                const point = props.payload[0]?.payload as { _event?: string } | undefined;
                const eventLabel = point?._event;
                return (
                  <div style={{
                    backgroundColor: "hsl(222 20% 11%)",
                    border: "1px solid hsl(222 20% 18%)",
                    borderRadius: 6,
                    padding: "8px 10px",
                    fontSize: 12,
                  }}>
                    <p style={{ color: "hsl(210 20% 95%)", marginBottom: eventLabel ? 4 : 0 }}>
                      {fmtHHMM(props.label as number)}
                    </p>
                    {eventLabel && (
                      <p style={{ color: "hsl(45 90% 65%)", fontWeight: 600, marginBottom: 4 }}>
                        ⚑ {eventLabel}
                      </p>
                    )}
                    {props.payload.map((entry) => {
                      if (entry.name === "_event" || entry.value == null) return null;
                      return (
                        <p key={entry.name} style={{ color: entry.color, margin: "2px 0" }}>
                          {entry.name} : {typeof entry.value === "number" ? entry.value.toFixed(2) : entry.value}
                        </p>
                      );
                    })}
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: "hsl(210 20% 95%)" }} />
            <Line type="monotone" dataKey="press"   stroke="hsl(45 90% 55%)"  strokeWidth={1.5} dot={false} name="Mask press (cmH₂O)" connectNulls={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="leak"    stroke="hsl(0 70% 55%)"   strokeWidth={1}   dot={false} name="Leak (L/min)"        connectNulls={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="snore"   stroke="hsl(280 70% 60%)" strokeWidth={1}   dot={false} name="Snore index"         connectNulls={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="flowLim" stroke="hsl(160 60% 50%)" strokeWidth={1}   dot={false} name="Flow limitation"     connectNulls={false} isAnimationActive={false} />
            {/* hidden line so _event appears in payload for tooltip */}
            <Line type="monotone" dataKey="_event" stroke="transparent" dot={false} name="_event" legendType="none" isAnimationActive={false} />
            {visibleEvents.map((ev) => {
              const color     = EVENT_COLORS[ev.event_type]      ?? "hsl(210 20% 95%)";
              const abbr      = EVENT_ABBR[ev.event_type]        ?? ev.event_type;
              const textColor = EVENT_TEXT_COLORS[ev.event_type] ?? "#fff";
              return (
                <ReferenceLine
                  key={ev.id}
                  x={new Date(ev.event_time_utc).getTime()}
                  stroke={color}
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                >
                  <Label
                    content={(labelProps) => (
                      <EventFlagLabel
                        viewBox={labelProps.viewBox as { x?: number; y?: number; height?: number }}
                        label={abbr}
                        color={color}
                        textColor={textColor}
                      />
                    )}
                  />
                </ReferenceLine>
              );
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Scroll to zoom · drag to pan · double-click to reset</p>
    </div>
  );
}

export default memo(NightPldChart);
