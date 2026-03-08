import { notFound } from "next/navigation";
import { getSession } from "@/lib/queries/sessions";
import { getSessionPld } from "@/lib/queries/pld";
import { getSessionEvents } from "@/lib/queries/events";
import { getSessionBrp1s } from "@/lib/queries/brp";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import SessionDetailChart from "@/components/charts/SessionDetailChart";
import BrpOverviewChart from "@/components/charts/BrpOverviewChart";
import BrpWaveformCanvas from "@/components/charts/BrpWaveformCanvas";
import { formatTs, fmtMinutes } from "@/lib/utils";

export const dynamic = "force-dynamic";

const EVENT_BADGE: Record<string, "danger" | "warning" | "default" | "secondary"> = {
  "Obstructive Apnea":  "danger",
  "Central Apnea":      "default",
  "Hypopnea":           "warning",
  "Unclassified Apnea": "secondary",
  "RERA":               "secondary",
};

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sessionId = parseInt(id);
  if (isNaN(sessionId)) notFound();

  const [session, pld, events, brp1s] = await Promise.all([
    getSession(sessionId),
    getSessionPld(sessionId),
    getSessionEvents(sessionId),
    getSessionBrp1s(sessionId),
  ]);

  if (!session) notFound();

  // Duration: prefer BRP max offset, then session_end - session_start, then last PLD offset
  const brpDurationS = brp1s.length > 0 ? brp1s[brp1s.length - 1]!.offset_s : null;
  const durationMin  = brpDurationS != null
    ? brpDurationS / 60
    : session.session_end_utc
      ? (new Date(session.session_end_utc).getTime() - new Date(session.session_start_utc).getTime()) / 60000
      : pld.length > 0 ? pld[pld.length - 1]!.offset_s / 60
      : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Session Detail</h1>
        <p className="font-mono text-sm text-muted-foreground">{formatTs(session.session_start_utc)}</p>
      </div>

      {/* Meta row */}
      <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
        <span>Duration: <span className="text-foreground">{fmtMinutes(durationMin)}</span></span>
        <span>Events: <span className="text-foreground">{events.length}</span></span>
        <span>PLD samples: <span className="text-foreground">{pld.length.toLocaleString()}</span></span>
        <span>BRP 1s buckets: <span className="text-foreground">{brp1s.length.toLocaleString()}</span></span>
      </div>

      {/* Events table */}
      {events.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Scored Events ({events.length})</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wider">
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-right">Time</th>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* PLD + events timeline */}
      <Card>
        <CardHeader><CardTitle>Pressure, Leak &amp; Events</CardTitle></CardHeader>
        <CardContent>
          <SessionDetailChart pld={pld} events={events} sessionStart={session.session_start_utc} sessionEndUtc={session.session_end_utc} />
        </CardContent>
      </Card>

      {/* BRP waveform overview (Recharts, 1s buckets) */}
      {brp1s.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Flow &amp; Pressure Waveform (1s overview)</CardTitle>
          </CardHeader>
          <CardContent>
            <BrpOverviewChart data={brp1s} sessionStart={session.session_start_utc} />
          </CardContent>
        </Card>
      )}

      {/* BRP full-resolution canvas viewer */}
      {brp1s.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Full-Resolution BRP Viewer</CardTitle>
          </CardHeader>
          <CardContent>
            <BrpWaveformCanvas sessionId={sessionId} sessionStart={session.session_start_utc} height={340} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
