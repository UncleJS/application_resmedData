import { Suspense } from "react";
import { getStatCards, getAhiTrend } from "@/lib/queries/summary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import AhiTrendChart from "@/components/charts/AhiTrendChart";
import DaysSelect from "@/components/DaysSelect";
import { ahiColor, fmtMinutes } from "@/lib/utils";

export const dynamic = "force-dynamic";

const VALID_DAYS = [7, 14, 30, 60, 90, 120, 150, 180, 270, 360, 540, 720, 900, 1080] as const;
type ValidDays = (typeof VALID_DAYS)[number];

function parseDays(raw: string | undefined): ValidDays {
  const n = Number(raw);
  return (VALID_DAYS as readonly number[]).includes(n) ? (n as ValidDays) : 30;
}

function ahiBadge(ahi: number | null) {
  if (ahi === null) return <Badge variant="outline">No data</Badge>;
  if (ahi < 5)  return <Badge variant="success">Normal &lt;5</Badge>;
  if (ahi < 15) return <Badge variant="warning">Mild &lt;15</Badge>;
  if (ahi < 30) return <Badge variant="warning">Moderate &lt;30</Badge>;
  return <Badge variant="danger">Severe ≥30</Badge>;
}

export default async function SummaryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const days = parseDays(
    Array.isArray(params.days) ? params.days[0] : params.days
  );

  const [stats, trend] = await Promise.all([
    getStatCards(days),
    getAhiTrend(days),
  ]);

  return (
    <div className="space-y-6">
      {/* Header row with title + days dropdown */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Summary</h1>
          <p className="text-sm text-muted-foreground">Last {days} days</p>
        </div>
        <Suspense fallback={null}>
          <DaysSelect value={days} />
        </Suspense>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardHeader><CardTitle>Avg AHI</CardTitle></CardHeader>
          <CardContent>
            <p className={`text-3xl font-bold ${ahiColor(stats.avgAhi)}`}>
              {stats.avgAhi?.toFixed(1) ?? "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">events/hr</p>
            <div className="mt-2">{ahiBadge(stats.avgAhi)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Avg Usage</CardTitle></CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-foreground">
              {fmtMinutes(stats.avgDurationMin)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">per night</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Compliance</CardTitle></CardHeader>
          <CardContent>
            <p className={`text-3xl font-bold ${(stats.compliancePct ?? 0) >= 70 ? "text-emerald-400" : "text-yellow-400"}`}>
              {stats.compliancePct?.toFixed(0) ?? "—"}%
            </p>
            <p className="text-xs text-muted-foreground mt-1">nights ≥4h usage</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Avg Leak p95</CardTitle></CardHeader>
          <CardContent>
            <p className={`text-3xl font-bold ${(stats.avgLeak95 ?? 0) > 0.4 ? "text-red-400" : "text-emerald-400"}`}>
              {stats.avgLeak95 != null ? (stats.avgLeak95 * 60).toFixed(1) : "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">L/min</p>
          </CardContent>
        </Card>
      </div>

      {/* AHI trend chart */}
      <Card>
        <CardHeader>
          <CardTitle>AHI — {days}-day trend</CardTitle>
        </CardHeader>
        <CardContent>
          <AhiTrendChart data={trend} avg={stats.avgAhi} />
        </CardContent>
      </Card>
    </div>
  );
}
