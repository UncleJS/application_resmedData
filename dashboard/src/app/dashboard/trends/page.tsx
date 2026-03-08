import { getTrends } from "@/lib/queries/summary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import MetricLineChart from "@/components/charts/MetricLineChart";

export const dynamic = "force-dynamic";

const METRIC_GROUPS = [
  {
    title: "AHI & Apnea Indices",
    metrics: [
      { key: "ahi"  as const, label: "AHI",  color: "hsl(213 90% 55%)" },
      { key: "oai"  as const, label: "OAI",  color: "hsl(0 70% 55%)" },
      { key: "cai"  as const, label: "CAI",  color: "hsl(160 60% 50%)" },
      { key: "hi"   as const, label: "HI",   color: "hsl(45 90% 55%)" },
    ],
  },
  {
    title: "Pressure (cmH₂O)",
    metrics: [
      { key: "mask_press_95" as const, label: "Mask p95",  color: "hsl(45 90% 55%)" },
    ],
  },
  {
    title: "Leak (L/s)",
    metrics: [
      { key: "leak_95" as const, label: "Leak p95", color: "hsl(0 70% 55%)" },
    ],
  },
  {
    title: "Respiration",
    metrics: [
      { key: "resp_rate_50" as const, label: "Resp rate median (bpm)", color: "hsl(213 90% 55%)" },
      { key: "tid_vol_50"   as const, label: "Tidal vol median (L)",   color: "hsl(280 70% 60%)" },
    ],
  },
];

export default async function TrendsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const data = await getTrends(sp.from, sp.to);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Therapy Trends</h1>
        <p className="text-sm text-muted-foreground">{data.length} nights</p>
      </div>

      {METRIC_GROUPS.map((group) => (
        <Card key={group.title}>
          <CardHeader><CardTitle>{group.title}</CardTitle></CardHeader>
          <CardContent>
            <MetricLineChart data={data} metrics={group.metrics} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
