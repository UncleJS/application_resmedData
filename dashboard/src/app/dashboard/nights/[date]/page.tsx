import { notFound } from "next/navigation";
import Link from "next/link";
import { getNightSummary } from "@/lib/queries/summary";
import { getNightSessions } from "@/lib/queries/sessions";
import { getNightEvents } from "@/lib/queries/events";
import { getNightPld } from "@/lib/queries/pld";
import { getNightBrp1s } from "@/lib/queries/brp";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import NightPldChart from "@/components/charts/NightPldChart";
import NightBrpOverviewChart from "@/components/charts/NightBrpOverviewChart";
import NightBrpWaveformCanvas from "@/components/charts/NightBrpWaveformCanvas";
import { ahiColor, fmtMinutes, formatTs } from "@/lib/utils";

export const dynamic = "force-dynamic";

const EVENT_BADGE: Record<string, "danger" | "warning" | "default" | "secondary"> = {
  "Obstructive Apnea":  "danger",
  "Central Apnea":      "default",
  "Hypopnea":           "warning",
  "Unclassified Apnea": "secondary",
  "RERA":               "secondary",
};

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold text-foreground">{value}</span>
    </div>
  );
}

export default async function NightDetailPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;

  // Basic date sanity check
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();

  const [summary, sessions, events, pld, brp1s] = await Promise.all([
    getNightSummary(date),
    getNightSessions(date),
    getNightEvents(date),
    getNightPld(date),
    getNightBrp1s(date),
  ]);

  if (!summary && sessions.length === 0) notFound();

  const s = summary;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-foreground">Night: {date}</h1>
        <p className="text-sm text-muted-foreground">
          {sessions.length} session{sessions.length !== 1 ? "s" : ""} · {events.length} scored event{events.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Summary stat cards */}
      {s && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {/* AHI */}
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">AHI</span>
                <span className={`text-2xl font-bold ${ahiColor(s.ahi)}`}>
                  {s.ahi != null ? s.ahi.toFixed(1) : "—"}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Usage */}
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">Usage</span>
                <span className="text-2xl font-bold text-foreground">
                  {fmtMinutes(s.on_duration_min)}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Event breakdown */}
          <Card>
            <CardContent className="pt-4 pb-4 space-y-1">
              <StatItem label="OAI"  value={s.oai  != null ? s.oai.toFixed(1)  : "—"} />
              <StatItem label="CAI"  value={s.cai  != null ? s.cai.toFixed(1)  : "—"} />
              <StatItem label="HI"   value={s.hi   != null ? s.hi.toFixed(1)   : "—"} />
              <StatItem label="UAI"  value={s.uai  != null ? s.uai.toFixed(1)  : "—"} />
            </CardContent>
          </Card>

          {/* Mask pressure */}
          <Card>
            <CardContent className="pt-4 pb-4 space-y-1">
              <StatItem
                label="Mask Press p50"
                value={s.mask_press_50 != null ? `${s.mask_press_50.toFixed(1)} cmH₂O` : "—"}
              />
              <StatItem
                label="Mask Press p95"
                value={s.mask_press_95 != null ? `${s.mask_press_95.toFixed(1)} cmH₂O` : "—"}
              />
            </CardContent>
          </Card>

          {/* Leak */}
          <Card>
            <CardContent className="pt-4 pb-4 space-y-1">
              <StatItem
                label="Leak p50"
                value={s.leak_50 != null ? `${(s.leak_50 * 60).toFixed(1)} L/min` : "—"}
              />
              <StatItem
                label="Leak p95"
                value={s.leak_95 != null ? `${(s.leak_95 * 60).toFixed(1)} L/min` : "—"}
              />
            </CardContent>
          </Card>

          {/* Resp rate */}
          <Card>
            <CardContent className="pt-4 pb-4 space-y-1">
              <StatItem
                label="Resp Rate p50"
                value={s.resp_rate_50 != null ? `${s.resp_rate_50.toFixed(1)} /min` : "—"}
              />
              <StatItem
                label="Resp Rate p95"
                value={s.resp_rate_95 != null ? `${s.resp_rate_95.toFixed(1)} /min` : "—"}
              />
            </CardContent>
          </Card>

          {/* Tidal volume */}
          <Card>
            <CardContent className="pt-4 pb-4 space-y-1">
              <StatItem
                label="Tidal Vol p50"
                value={s.tid_vol_50 != null ? `${s.tid_vol_50.toFixed(0)} mL` : "—"}
              />
              <StatItem
                label="Tidal Vol p95"
                value={s.tid_vol_95 != null ? `${s.tid_vol_95.toFixed(0)} mL` : "—"}
              />
            </CardContent>
          </Card>

          {/* Mask events */}
          <Card>
            <CardContent className="pt-4 pb-4">
              <StatItem
                label="Mask Events"
                value={s.mask_events != null ? String(s.mask_events) : "—"}
              />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Sessions table */}
      <Card>
        <CardHeader>
          <CardTitle>Sessions ({sessions.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {sessions.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">No sessions recorded for this night.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wider">
                     <th className="px-4 py-3 text-left">Session start</th>
                    <th className="px-4 py-3 text-left">End</th>
                    <th className="px-4 py-3 text-right">Duration</th>
                    <th className="px-4 py-3 text-right"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sessions.map((sess) => (
                    <tr key={sess.id} className="hover:bg-accent/50 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-foreground">
                        {formatTs(sess.session_start_utc)}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-foreground">
                        {sess.session_end_utc ? formatTs(sess.session_end_utc) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right text-foreground">
                        {fmtMinutes(sess.duration_min)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/dashboard/sessions/${sess.id}`}>Detail →</Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Scored events table */}
      {events.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Scored Events ({events.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wider">
                    <th className="px-4 py-3 text-left">Type</th>
                    <th className="px-4 py-3 text-right">Time</th>
                    <th className="px-4 py-3 text-right">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {events.map((ev) => (
                    <tr key={ev.id} className="hover:bg-accent/50 transition-colors">
                      <td className="px-4 py-2">
                        <Badge variant={EVENT_BADGE[ev.event_type] ?? "secondary"}>
                          {ev.event_type}
                        </Badge>
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-muted-foreground">
                        {formatTs(ev.event_time_utc)}
                      </td>
                      <td className="px-4 py-2 text-right text-muted-foreground">
                        {ev.duration_s > 0 ? `${ev.duration_s.toFixed(1)}s` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Night charts — stitched across all sessions, at the bottom */}
      {pld.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Pressure, Leak &amp; Events</CardTitle></CardHeader>
          <CardContent>
            <NightPldChart pld={pld} events={events} />
          </CardContent>
        </Card>
      )}

      {brp1s.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Flow &amp; Pressure Waveform (1s overview)</CardTitle></CardHeader>
          <CardContent>
            <NightBrpOverviewChart data={brp1s} />
          </CardContent>
        </Card>
      )}

      {brp1s.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Full-Resolution BRP Viewer</CardTitle></CardHeader>
          <CardContent>
            <NightBrpWaveformCanvas nightDate={date} height={340} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
