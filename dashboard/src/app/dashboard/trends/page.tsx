import { Suspense } from "react";
import { getTrends } from "@/lib/queries/summary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import MetricLineChart from "@/components/charts/MetricLineChart";
import DaysSelect from "@/components/DaysSelect";

export const dynamic = "force-dynamic";

const VALID_DAYS = [30, 60, 90, 120, 150, 180, 270, 360] as const;
type ValidDays = (typeof VALID_DAYS)[number];

function parseDays(raw: string | undefined): ValidDays {
  const n = Number(raw);
  return (VALID_DAYS as readonly number[]).includes(n) ? (n as ValidDays) : 90;
}

/** Return YYYY-MM-DD for N days ago */
function daysAgoDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export default async function TrendsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const days = parseDays(
    Array.isArray(params.days) ? params.days[0] : params.days
  );

  const data = await getTrends(daysAgoDate(days));

  // Pressure setting step-lines — one data point per day, null where no data
  // s_as_min_press / s_as_max_press come per-row from daily_summary
  const pressureExtraLines = [
    { dataKey: "s_as_min_press", label: "Setting Min", color: "hsl(213 90% 55%)", strokeDasharray: "6 3" },
    { dataKey: "s_as_max_press", label: "Setting Max", color: "hsl(0 70% 55%)",   strokeDasharray: "6 3" },
  ];

  const metricGroups = [
    {
      title: "AHI & Apnea Indices",
      metrics: [
        { key: "ahi"  as const, label: "AHI",  color: "hsl(213 90% 55%)" },
        { key: "oai"  as const, label: "OAI",  color: "hsl(0 70% 55%)" },
        { key: "cai"  as const, label: "CAI",  color: "hsl(160 60% 50%)" },
        { key: "hi"   as const, label: "HI",   color: "hsl(45 90% 55%)" },
      ],
      refLines: undefined,
      extraLines: undefined,
    },
    {
      title: "Pressure (cmH₂O)",
      metrics: [
        { key: "mask_press_95" as const, label: "Mask p95", color: "hsl(45 90% 55%)" },
      ],
      refLines: undefined,
      extraLines: pressureExtraLines,
      yDomain: [0, 20] as [number, number],
    },
    {
      title: "Leak (L/s)",
      metrics: [
        { key: "leak_95" as const, label: "Leak p95", color: "hsl(0 70% 55%)" },
      ],
      refLines: undefined,
      extraLines: undefined,
    },
    {
      title: "Respiration",
      metrics: [
        { key: "resp_rate_50" as const, label: "Resp rate median (bpm)", color: "hsl(213 90% 55%)" },
        { key: "tid_vol_50"   as const, label: "Tidal vol median (L)",   color: "hsl(280 70% 60%)" },
      ],
      refLines: undefined,
      extraLines: undefined,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header row with title + days dropdown */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Therapy Trends</h1>
          <p className="text-sm text-muted-foreground">{data.length} nights · last {days} days</p>
        </div>
        <Suspense fallback={null}>
          <DaysSelect value={days} />
        </Suspense>
      </div>

      {metricGroups.map((group) => (
        <Card key={group.title}>
          <CardHeader><CardTitle>{group.title}</CardTitle></CardHeader>
          <CardContent>
            <MetricLineChart data={data} metrics={group.metrics} refLines={group.refLines} yDomain={group.yDomain} extraLines={group.extraLines} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
