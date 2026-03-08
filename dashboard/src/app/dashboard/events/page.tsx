import { Suspense } from "react";
import { getEventBreakdown } from "@/lib/queries/events";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import EventBreakdownChart from "@/components/charts/EventBreakdownChart";
import DaysSelect from "@/components/DaysSelect";

export const dynamic = "force-dynamic";

const VALID_DAYS = [30, 60, 90, 120, 150, 180, 270, 360] as const;
type ValidDays = (typeof VALID_DAYS)[number];

function parseDays(raw: string | undefined): ValidDays {
  const n = Number(raw);
  return (VALID_DAYS as readonly number[]).includes(n) ? (n as ValidDays) : 90;
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const days = parseDays(
    Array.isArray(params.days) ? params.days[0] : params.days
  );

  const data = await getEventBreakdown(undefined, undefined, days);

  const total = data.reduce((sum, r) => sum + Number(r.cnt), 0);

  // Summary by type
  const byType = data.reduce<Record<string, number>>((acc, r) => {
    acc[r.event_type] = (acc[r.event_type] ?? 0) + Number(r.cnt);
    return acc;
  }, {});

  const nightSet = new Set(data.map((r) => r.night));
  const nightCount = nightSet.size;
  const firstNight = nightSet.size ? [...nightSet].sort()[0] : null;
  const lastNight  = nightSet.size ? [...nightSet].sort().at(-1) : null;
  const rangeLabel = firstNight && lastNight
    ? `${firstNight} → ${lastNight}`
    : "no data";

  return (
    <div className="space-y-6">
      {/* Header row with title + days dropdown */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Event Breakdown</h1>
          <p className="text-sm text-muted-foreground">
            {total} events across {nightCount} nights with events ({rangeLabel})
          </p>
        </div>
        <Suspense fallback={null}>
          <DaysSelect value={days} />
        </Suspense>
      </div>

      {/* Type summary cards */}
      <div className="flex flex-wrap gap-3">
        {Object.entries(byType).map(([type, cnt]) => (
          <div key={type} className="rounded-md border border-border bg-card px-3 py-2 text-sm">
            <p className="text-muted-foreground text-xs">{type}</p>
            <p className="text-foreground font-semibold">{cnt}</p>
          </div>
        ))}
      </div>

      {/* Stacked bar by night */}
      <Card>
        <CardHeader><CardTitle>Events by night</CardTitle></CardHeader>
        <CardContent>
          <EventBreakdownChart data={data} />
        </CardContent>
      </Card>
    </div>
  );
}
